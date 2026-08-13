// providers/hermes.rs — Hermes（Nous Research 的 Hermes Agent）会话 provider。
//
// **本项目首个 SQLite provider**：Hermes 会话不落 JSON 镜像，只写单个 SQLite 库
// `hermes/state.db`。故本文件用 rusqlite **只读**打开该库读取会话/消息/用量，
// 而非像 claude/codex/opencode 那样解析 JSON 文件。
//
// 关键差异（相对其它 provider）：
// - 数据源是单个 SQLite 库，而非目录下的一堆 JSON。
// - 时间是 **epoch 秒·浮点**（started_at/last_activity_at/messages.timestamp），
//   需自行转 DateTime<Utc>（注意是「秒」不是「毫秒」）。
// - 单库变更难映射到单会话 → classify_event 一律 FullRescan、scan_one 恒 None。
// - **始终只读打开**（OpenFlags::SQLITE_OPEN_READ_ONLY）：Hermes 可能正开着库，
//   WAL 模式下并发只读是安全的，且绝不写入用户数据。

use super::{tool_target_summary, truncate, EventKind, SessionProvider, WatchRoot};
use crate::models::{Session, TimelineMessage};
use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{Connection, OpenFlags};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// 时间轴单条消息字符上限：对真实消息等于「不截断」，仅对病态巨型粘贴保留兜底（同 opencode/codex）。
const TIMELINE_MSG_CHARS: usize = 20000;

// ============================================================
// HermesProvider 主体
// ============================================================

pub struct HermesProvider;

impl SessionProvider for HermesProvider {
    fn id(&self) -> &'static str {
        "hermes"
    }

    fn display_name(&self) -> &'static str {
        "Hermes"
    }

    /// state.db 在任一候选路径存在 → 视为可用。
    fn is_available(&self) -> bool {
        state_db_path().map(|p| p.exists()).unwrap_or(false)
    }

    /// 监听 state.db 所在目录。就一个库文件，recursive=false 足矣
    /// （WAL 会额外产生 state.db-wal/-shm，都在同目录，非递归也能收到）。
    fn watch_roots(&self) -> Vec<WatchRoot> {
        match state_db_path().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
            Some(dir) => vec![WatchRoot {
                path: dir,
                recursive: false,
            }],
            None => Vec::new(),
        }
    }

    /// 探测路径：state.db 本身（用于定期轮询）。
    fn refresh_probe_paths(&self) -> Vec<PathBuf> {
        match state_db_path() {
            Some(p) => vec![p],
            None => Vec::new(),
        }
    }

    /// 全量扫描：只读打开 state.db，读出所有会话。
    fn scan_all(&self) -> Vec<Session> {
        let db = match state_db_path() {
            Some(p) => p,
            None => return Vec::new(),
        };
        let conn = match open_readonly(&db) {
            Some(c) => c,
            None => return Vec::new(),
        };
        scan_all_from_conn(&conn)
    }

    /// 事件分类：路径是 state.db 或其 WAL/SHM 边车 → FullRescan（单库变更难映射到单会话）；
    /// 否则 Ignore。
    fn classify_event(&self, path: &Path) -> EventKind {
        let db = match state_db_path() {
            Some(p) => p,
            None => return EventKind::Ignore,
        };
        if is_state_db_related(path, &db) {
            EventKind::FullRescan
        } else {
            EventKind::Ignore
        }
    }

    /// 增量扫描：state.db 变更无法定位到单个会话 → 返回 None，
    /// 由 classify_event 的 FullRescan 覆盖。
    fn scan_one(&self, _path: &Path) -> Option<Session> {
        None
    }

    /// 生成 Hermes 会话恢复命令（字符串版）。
    /// ⚠️ 未核实：hermes 二进制不在 PATH，恢复子命令形态未经实测，v1 暂用
    /// `hermes --resume <id>`，待验证后修正。
    fn resume_command(&self, _project_path: &str, session_id: &str) -> String {
        format!("hermes --resume {}", session_id)
    }

    /// argv 版恢复命令：`["hermes", "--resume", <session_id>]`。
    /// session_id 作独立 argv 元素，web 侧直传 CommandBuilder、不经 shell → 无注入面。
    /// ⚠️ 未核实：同 resume_command，子命令形态待实测验证。
    fn resume_argv(&self, _project_path: &str, session_id: &str) -> Vec<String> {
        vec![
            "hermes".to_string(),
            "--resume".to_string(),
            session_id.to_string(),
        ]
    }

    /// 读取指定会话的时间轴消息列表（含工具调用条目）。
    fn read_timeline(&self, session_id: &str) -> Vec<TimelineMessage> {
        let db = match state_db_path() {
            Some(p) => p,
            None => return Vec::new(),
        };
        let conn = match open_readonly(&db) {
            Some(c) => c,
            None => return Vec::new(),
        };
        read_timeline_from_conn(&conn, session_id)
    }
}

// ============================================================
// state.db 定位 / 只读打开
// ============================================================

/// 按序探测第一个存在的 state.db 路径（跨平台）：
/// - Windows：`dirs::data_local_dir()/hermes/state.db`（= `%LOCALAPPDATA%\hermes\state.db`）。
/// - macOS/Linux：`dirs::home_dir()/.hermes/state.db`。
/// 全部不存在时，返回首个候选（供 watch/probe，即便暂不存在）。
fn state_db_path() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Windows 主路径：%LOCALAPPDATA%\hermes\state.db
    if let Some(local) = dirs::data_local_dir() {
        candidates.push(local.join("hermes").join("state.db"));
    }
    // macOS/Linux 路径：~/.hermes/state.db
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".hermes").join("state.db"));
    }

    if let Some(existing) = candidates.iter().find(|p| p.exists()) {
        return Some(existing.clone());
    }
    candidates.into_iter().next()
}

/// 判断路径是否为 state.db 或其 WAL/SHM 边车文件（state.db-wal / state.db-shm）。
/// 纯函数：便于 standalone 单测。
fn is_state_db_related(path: &Path, db: &Path) -> bool {
    if path == db {
        return true;
    }
    // 边车文件与主库同目录、文件名以 "state.db" 前缀开头（state.db-wal / state.db-shm / state.db-journal）
    let db_name = match db.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return false,
    };
    let same_dir = path.parent() == db.parent();
    let name_matches = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with(db_name))
        .unwrap_or(false);
    same_dir && name_matches
}

/// 只读打开 SQLite（SQLITE_OPEN_READ_ONLY）。失败一律返回 None（容错优先）。
/// Hermes 可能正开着库，WAL 只读并发安全，且绝不写入用户数据。
fn open_readonly(path: &Path) -> Option<Connection> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()
}

// ============================================================
// 扫描：从连接读所有会话
// ============================================================

/// 从只读连接扫描所有会话。抽出为独立函数便于测试（测试传内存/临时库连接）。
fn scan_all_from_conn(conn: &Connection) -> Vec<Session> {
    // 读会话主表所需列。保留 archived（暂不过滤，后续如需再加 WHERE archived=0）。
    let mut stmt = match conn.prepare(
        "SELECT id, source, model, title, cwd, git_repo_root, \
                started_at, last_activity_at, message_count, \
                input_tokens, output_tokens \
         FROM sessions",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = stmt.query_map([], |row| {
        Ok(HermesSessionRow {
            id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            model: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            title: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            cwd: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            git_repo_root: row.get::<_, Option<String>>(5)?,
            started_at: row.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
            last_activity_at: row.get::<_, Option<f64>>(7)?,
            message_count: row.get::<_, Option<i64>>(8)?.unwrap_or(0),
            input_tokens: row.get::<_, Option<i64>>(9)?.unwrap_or(0),
            output_tokens: row.get::<_, Option<i64>>(10)?.unwrap_or(0),
        })
    });

    let rows = match rows {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let mut sessions: Vec<Session> = Vec::new();
    for r in rows.flatten() {
        sessions.push(row_to_session(conn, &r));
    }
    // 按更新时间降序（最新在前），同其它 provider
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    sessions
}

/// sessions 表一行的原始数据（转换成 Session 前的中间态）。
struct HermesSessionRow {
    id: String,
    model: String,
    title: String,
    cwd: String,
    git_repo_root: Option<String>,
    started_at: f64,
    last_activity_at: Option<f64>,
    message_count: i64,
    input_tokens: i64,
    output_tokens: i64,
}

/// 把 sessions 行 + 该会话的 messages/session_model_usage 组装成 Session。
fn row_to_session(conn: &Connection, r: &HermesSessionRow) -> Session {
    // project_path：git_repo_root 非空优先，否则 cwd
    let project_path = match r.git_repo_root.as_deref() {
        Some(g) if !g.trim().is_empty() => g.to_string(),
        _ => r.cwd.clone(),
    };
    let project_name = project_name_from_dir(&project_path);

    // 时间：epoch 秒·浮点 → DateTime<Utc>
    let created_at = epoch_secs_to_utc(r.started_at).unwrap_or_else(Utc::now);
    let updated_at = r
        .last_activity_at
        .and_then(epoch_secs_to_utc)
        .unwrap_or(created_at);

    // total_tokens = input + output（NULL 已在读取时当 0）
    let total_tokens = (r.input_tokens.max(0) as u64) + (r.output_tokens.max(0) as u64);

    // by_model：优先 session_model_usage SUM 聚合；空则回退 {sessions.model: total_tokens}
    let by_model = load_by_model(conn, &r.id, &r.model, total_tokens);

    // 用户消息：读该会话所有 user 消息内容（按 timestamp 升序）
    let user_messages = load_user_messages(conn, &r.id);

    // first/last_prompt：首/末 user 消息；无 user 消息时用 title 兜底
    let first_prompt = user_messages
        .first()
        .cloned()
        .unwrap_or_else(|| r.title.clone());
    let last_prompt = user_messages
        .last()
        .cloned()
        .unwrap_or_else(|| r.title.clone());

    Session {
        session_id: r.id.clone(),
        provider: "hermes".to_string(),
        project_path,
        project_name,
        first_prompt,
        last_prompt,
        created_at,
        updated_at,
        // message_count 用 sessions.message_count（权威计数），负值兜 0
        message_count: r.message_count.max(0) as u32,
        user_messages,
        total_tokens,
        by_model,
    }
}

/// by_model：`SELECT model, SUM(input_tokens+output_tokens) FROM session_model_usage
/// WHERE session_id=? GROUP BY model`。同一 session 同 model 多行需 SUM 聚合。
/// 查不到任何行 → 回退 `{fallback_model: total_tokens}`（fallback_model 非空时）。
fn load_by_model(
    conn: &Connection,
    session_id: &str,
    fallback_model: &str,
    total_tokens: u64,
) -> HashMap<String, u64> {
    let mut by_model: HashMap<String, u64> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT model, SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)) \
         FROM session_model_usage WHERE session_id = ? GROUP BY model",
    ) {
        let rows = stmt.query_map([session_id], |row| {
            let model: Option<String> = row.get(0)?;
            let sum: Option<i64> = row.get(1)?;
            Ok((model.unwrap_or_default(), sum.unwrap_or(0).max(0) as u64))
        });
        if let Ok(rows) = rows {
            for (model, sum) in rows.flatten() {
                if !model.is_empty() {
                    *by_model.entry(model).or_insert(0) += sum;
                }
            }
        }
    }
    // 空则回退到会话主表的 model
    if by_model.is_empty() && !fallback_model.is_empty() {
        by_model.insert(fallback_model.to_string(), total_tokens);
    }
    by_model
}

/// 读该会话所有 role='user' 消息的 content，按 timestamp 升序。
fn load_user_messages(conn: &Connection, session_id: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT content FROM messages \
         WHERE session_id = ? AND role = 'user' ORDER BY timestamp",
    ) {
        let rows = stmt.query_map([session_id], |row| {
            Ok(row.get::<_, Option<String>>(0)?.unwrap_or_default())
        });
        if let Ok(rows) = rows {
            for content in rows.flatten() {
                if !content.is_empty() {
                    out.push(content);
                }
            }
        }
    }
    out
}

// ============================================================
// 时间轴读取
// ============================================================

/// 读取指定会话的时间轴：`SELECT role,content,tool_name,tool_calls,timestamp
/// FROM messages WHERE session_id=? ORDER BY timestamp`。
/// - role='user'/'assistant' 的 content 直接产出（非空时）。
/// - tool_calls 非空或 tool_name 非空 → 额外产出 role="tool" 条目（简洁摘要）。
fn read_timeline_from_conn(conn: &Connection, session_id: &str) -> Vec<TimelineMessage> {
    let mut stmt = match conn.prepare(
        "SELECT role, content, tool_name, tool_calls, timestamp \
         FROM messages WHERE session_id = ? ORDER BY timestamp",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = stmt.query_map([session_id], |row| {
        Ok(HermesMessageRow {
            role: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            content: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            tool_name: row.get::<_, Option<String>>(2)?,
            tool_calls: row.get::<_, Option<String>>(3)?,
            timestamp: row.get::<_, Option<f64>>(4)?,
        })
    });

    let rows = match rows {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let mut out: Vec<TimelineMessage> = Vec::new();
    for m in rows.flatten() {
        let ts = format_epoch_secs(m.timestamp);
        // 文本气泡：role='user'/'assistant' 的非空 content
        if !m.content.is_empty() {
            out.push(TimelineMessage {
                role: m.role.clone(),
                content: truncate(&m.content, TIMELINE_MSG_CHARS),
                timestamp: ts.clone(),
            });
        }
        // 工具调用条目：tool_calls 非空 或 tool_name 非空 → role="tool"
        if let Some(summary) = hermes_tool_summary(m.tool_calls.as_deref(), m.tool_name.as_deref()) {
            out.push(TimelineMessage {
                role: "tool".to_string(),
                content: summary,
                timestamp: ts.clone(),
            });
        }
    }
    // 限制最大消息数，防止超大 IPC 响应（保留最近 500 条，同 opencode/codex）。
    if out.len() > 500 {
        out.drain(0..out.len() - 500);
    }
    out
}

/// messages 表一行（时间轴用）。
struct HermesMessageRow {
    role: String,
    content: String,
    tool_name: Option<String>,
    tool_calls: Option<String>,
    timestamp: Option<f64>,
}

/// 纯函数：从 tool_calls(JSON 串) / tool_name 生成时间线「工具调用」简洁摘要。
/// 返回 None 表示既无 tool_calls 也无 tool_name（不产出 tool 条目）。
///
/// 解析策略（尽力而为）：
/// - tool_calls 是 JSON，尝试取工具名 + 目标：
///   * OpenAI 风格：`[{"function":{"name":"bash","arguments":"{\"command\":\"ls\"}"}}]`
///   * 通用风格：`[{"name":"read","input":{"file_path":"/a"}}]` 或 `{"name":...,"arguments":{...}}`
///   取到 → `"工具名: <目标摘要>"`；只取到工具名 → 工具名；
/// - tool_calls 取不到 → 退回 tool_name；
/// - 都取不到但 tool_calls 原串非空 → 截断原串兜底。
pub(crate) fn hermes_tool_summary(
    tool_calls: Option<&str>,
    tool_name: Option<&str>,
) -> Option<String> {
    let tc = tool_calls.map(|s| s.trim()).filter(|s| !s.is_empty());
    let tn = tool_name.map(|s| s.trim()).filter(|s| !s.is_empty());

    // 优先解析 tool_calls JSON
    if let Some(raw) = tc {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(raw) {
            // 数组取第一个；对象直接用
            let first = if let Some(arr) = val.as_array() {
                arr.first()
            } else {
                Some(&val)
            };
            if let Some(obj) = first {
                if let Some(summary) = summarize_tool_call(obj) {
                    return Some(summary);
                }
            }
        }
        // JSON 解析不出有效信息：有 tool_name 用之，否则截断原串兜底
        if let Some(name) = tn {
            return Some(name.to_string());
        }
        return Some(tool_target_summary(raw));
    }

    // 无 tool_calls，仅 tool_name
    tn.map(|s| s.to_string())
}

/// 从单个工具调用 JSON 对象提炼 `"工具名: 目标"`（目标可缺省）。
/// 兼容 OpenAI 的 `{"function":{"name","arguments"}}` 与通用 `{"name","input"/"arguments"}`。
fn summarize_tool_call(obj: &serde_json::Value) -> Option<String> {
    // 工具名：obj.function.name > obj.name > obj.tool
    let name = obj
        .get("function")
        .and_then(|f| f.get("name"))
        .and_then(|v| v.as_str())
        .or_else(|| obj.get("name").and_then(|v| v.as_str()))
        .or_else(|| obj.get("tool").and_then(|v| v.as_str()))
        .filter(|s| !s.is_empty())?;

    // 参数对象：obj.function.arguments（可能是 JSON 字符串）> obj.arguments > obj.input
    let args: Option<serde_json::Value> = obj
        .get("function")
        .and_then(|f| f.get("arguments"))
        .map(|a| {
            // arguments 常是被转义的 JSON 字符串，尝试二次解析
            if let Some(s) = a.as_str() {
                serde_json::from_str::<serde_json::Value>(s).unwrap_or(serde_json::Value::Null)
            } else {
                a.clone()
            }
        })
        .or_else(|| obj.get("arguments").cloned())
        .or_else(|| obj.get("input").cloned());

    // 从参数里挑一个「目标」字段（命令/文件/检索/URL 常见键名）
    let target = args.as_ref().and_then(pick_target_arg);
    match target {
        Some(t) => Some(format!("{}: {}", name, tool_target_summary(&t))),
        None => Some(name.to_string()),
    }
}

/// 从工具参数对象里挑一个有代表性的目标字符串（尽力而为，兼容多种命名）。
fn pick_target_arg(args: &serde_json::Value) -> Option<String> {
    let str_arg = |key: &str| -> Option<String> {
        args.get(key)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
    };
    str_arg("command")
        .or_else(|| str_arg("file_path"))
        .or_else(|| str_arg("filePath"))
        .or_else(|| str_arg("path"))
        .or_else(|| str_arg("pattern"))
        .or_else(|| str_arg("query"))
        .or_else(|| str_arg("url"))
}

// ============================================================
// 纯函数辅助（可 standalone 单测）
// ============================================================

/// epoch 秒·浮点 → DateTime<Utc>。非法/越界 → None。
/// 注意：Hermes 时间是「秒」（如 1786606097.8965），非毫秒。
fn epoch_secs_to_utc(secs: f64) -> Option<DateTime<Utc>> {
    if !secs.is_finite() || secs <= 0.0 {
        return None;
    }
    // 秒·浮点 → 整秒 + 纳秒余数
    let whole = secs.trunc() as i64;
    let nanos = ((secs.fract()) * 1_000_000_000.0).round() as u32;
    match Utc.timestamp_opt(whole, nanos) {
        chrono::LocalResult::Single(dt) => Some(dt),
        _ => None,
    }
}

/// epoch 秒·浮点 → HH:MM:SS 时间串（用于时间轴；同其它 provider 思路）。
/// 无时间戳或非法 → 空串。
fn format_epoch_secs(secs: Option<f64>) -> String {
    match secs.and_then(epoch_secs_to_utc) {
        Some(dt) => dt.format("%H:%M:%S").to_string(),
        None => String::new(),
    }
}

/// 从工作目录取项目名（最后一段目录名）。兼容 Windows(`\`) 与 Unix(`/`) 分隔符。
fn project_name_from_dir(dir: &str) -> String {
    let trimmed = dir.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_string()
}

// ============================================================
// 单元测试（TDD）：用 rusqlite 建临时 state.db，插样本数据后断言映射。
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// 建一个内存库并造出 Hermes 所需的三张表（仅本 provider 用到的列）。
    fn make_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                source TEXT,
                model TEXT,
                title TEXT,
                cwd TEXT,
                git_repo_root TEXT,
                started_at REAL,
                last_activity_at REAL,
                message_count INTEGER,
                input_tokens INTEGER,
                output_tokens INTEGER,
                archived INTEGER
             );
             CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                role TEXT,
                content TEXT,
                tool_call_id TEXT,
                tool_calls TEXT,
                tool_name TEXT,
                timestamp REAL,
                token_count INTEGER
             );
             CREATE TABLE session_model_usage (
                session_id TEXT,
                model TEXT,
                input_tokens INTEGER,
                output_tokens INTEGER,
                estimated_cost_usd REAL
             );",
        )
        .unwrap();
        conn
    }

    /// 造 1 会话 + 2 消息（user/assistant，assistant 带 tool_calls）+ 2 条同模型 usage（验 SUM）。
    fn seed(conn: &Connection) {
        // 会话：cwd 用 Windows 风格分隔符验证 project_name；git_repo_root 为 NULL → 用 cwd
        conn.execute(
            "INSERT INTO sessions (id, source, model, title, cwd, git_repo_root, \
                 started_at, last_activity_at, message_count, input_tokens, output_tokens, archived) \
             VALUES (?, 'cli', 'upstage/solar-pro4:free', '测试', \
                 'C:\\Users\\dev\\hermes-agent', NULL, \
                 1786606097.8965, 1786606100.5, 2, 40766, 66, 0)",
            ["20260813_152727_b405ee"],
        )
        .unwrap();

        // user 消息（时间在前）
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, tool_calls, tool_name, timestamp) \
             VALUES ('m1', '20260813_152727_b405ee', 'user', '你好 Hermes', NULL, NULL, 1786606097.90)",
            [],
        )
        .unwrap();
        // assistant 消息带 tool_calls（OpenAI 风格：function.name + arguments JSON 串）
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, tool_calls, tool_name, timestamp) \
             VALUES ('m2', '20260813_152727_b405ee', 'assistant', '我来执行命令', \
                 '[{\"function\":{\"name\":\"bash\",\"arguments\":\"{\\\"command\\\":\\\"ls -la\\\"}\"}}]', \
                 'bash', 1786606099.0)",
            [],
        )
        .unwrap();

        // session_model_usage：同一 session 同 model 两行 → 需 SUM
        conn.execute(
            "INSERT INTO session_model_usage (session_id, model, input_tokens, output_tokens) \
             VALUES ('20260813_152727_b405ee', 'upstage/solar-pro4:free', 20000, 30)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session_model_usage (session_id, model, input_tokens, output_tokens) \
             VALUES ('20260813_152727_b405ee', 'upstage/solar-pro4:free', 20766, 36)",
            [],
        )
        .unwrap();
    }

    /// TDD：scan_all 从库读出 1 会话，断言字段映射。
    #[test]
    fn scan_all_maps_session_fields() {
        let conn = make_db();
        seed(&conn);
        let sessions = scan_all_from_conn(&conn);
        assert_eq!(sessions.len(), 1);
        let s = &sessions[0];

        assert_eq!(s.session_id, "20260813_152727_b405ee");
        assert_eq!(s.provider, "hermes");
        // git_repo_root 为 NULL → project_path 用 cwd
        assert_eq!(s.project_path, "C:\\Users\\dev\\hermes-agent");
        assert_eq!(s.project_name, "hermes-agent");
        // message_count 用 sessions.message_count
        assert_eq!(s.message_count, 2);
        // total_tokens = input + output = 40766 + 66
        assert_eq!(s.total_tokens, 40832);
        // by_model：session_model_usage SUM = (20000+30)+(20766+36) = 40832
        assert_eq!(
            s.by_model.get("upstage/solar-pro4:free"),
            Some(&40832u64)
        );
        // first/last_prompt：仅一条 user 消息
        assert_eq!(s.first_prompt, "你好 Hermes");
        assert_eq!(s.last_prompt, "你好 Hermes");
        // created_at 从 epoch 秒·浮点转换正确
        assert_eq!(s.created_at, epoch_secs_to_utc(1786606097.8965).unwrap());
        assert_eq!(s.updated_at, epoch_secs_to_utc(1786606100.5).unwrap());
    }

    /// git_repo_root 非空时 project_path 用它。
    #[test]
    fn project_path_prefers_git_root() {
        let conn = make_db();
        conn.execute(
            "INSERT INTO sessions (id, model, cwd, git_repo_root, started_at, message_count, input_tokens, output_tokens) \
             VALUES ('s2', 'm', '/tmp/sub/dir', '/tmp/repo', 1786606097.0, 0, 0, 0)",
            [],
        )
        .unwrap();
        let sessions = scan_all_from_conn(&conn);
        assert_eq!(sessions[0].project_path, "/tmp/repo");
        assert_eq!(sessions[0].project_name, "repo");
    }

    /// by_model 回退：无 session_model_usage 行 → 用 sessions.model + total_tokens。
    #[test]
    fn by_model_falls_back_to_session_model() {
        let conn = make_db();
        conn.execute(
            "INSERT INTO sessions (id, model, cwd, started_at, message_count, input_tokens, output_tokens) \
             VALUES ('s3', 'anthropic/claude', '/p', 1786606097.0, 1, 100, 50)",
            [],
        )
        .unwrap();
        let sessions = scan_all_from_conn(&conn);
        assert_eq!(sessions[0].by_model.get("anthropic/claude"), Some(&150u64));
    }

    /// TDD：read_timeline 产出文本气泡 + tool 条目。
    #[test]
    fn timeline_includes_tool_entry() {
        let conn = make_db();
        seed(&conn);
        let msgs = read_timeline_from_conn(&conn, "20260813_152727_b405ee");
        // user 文本 + assistant 文本 + assistant 的 tool 条目 = 3
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0].role, "user");
        assert_eq!(msgs[0].content, "你好 Hermes");
        assert_eq!(msgs[1].role, "assistant");
        assert_eq!(msgs[1].content, "我来执行命令");
        assert_eq!(msgs[2].role, "tool");
        assert_eq!(msgs[2].content, "bash: ls -la");
    }

    /// hermes_tool_summary：OpenAI 风格 function.name + arguments。
    #[test]
    fn tool_summary_openai_style() {
        let tc = r#"[{"function":{"name":"read","arguments":"{\"file_path\":\"/a.rs\"}"}}]"#;
        assert_eq!(
            hermes_tool_summary(Some(tc), None).unwrap(),
            "read: /a.rs"
        );
    }

    /// hermes_tool_summary：通用风格 name + input。
    #[test]
    fn tool_summary_generic_style() {
        let tc = r#"[{"name":"glob","input":{"pattern":"**/*.rs"}}]"#;
        assert_eq!(
            hermes_tool_summary(Some(tc), None).unwrap(),
            "glob: **/*.rs"
        );
    }

    /// hermes_tool_summary：无 tool_calls 时退回 tool_name；两者皆空 → None。
    #[test]
    fn tool_summary_fallbacks() {
        assert_eq!(hermes_tool_summary(None, Some("web_search")).unwrap(), "web_search");
        assert!(hermes_tool_summary(None, None).is_none());
        assert!(hermes_tool_summary(Some(""), Some("")).is_none());
        // 非法 JSON 但有 tool_name → 用 tool_name
        assert_eq!(hermes_tool_summary(Some("not json"), Some("bash")).unwrap(), "bash");
    }

    /// epoch 秒·浮点 → DateTime 转换（纯函数）。注意是秒不是毫秒。
    #[test]
    fn epoch_secs_converts() {
        let dt = epoch_secs_to_utc(1786606097.0).unwrap();
        assert_eq!(dt.timestamp(), 1786606097);
        // 非法/非正 → None
        assert!(epoch_secs_to_utc(0.0).is_none());
        assert!(epoch_secs_to_utc(-1.0).is_none());
        assert!(epoch_secs_to_utc(f64::NAN).is_none());
    }

    /// project_name：Windows/Unix 分隔符都要处理。
    #[test]
    fn project_name_both_separators() {
        assert_eq!(project_name_from_dir("C:\\Users\\dev\\hermes-agent"), "hermes-agent");
        assert_eq!(project_name_from_dir("/home/u/proj"), "proj");
        assert_eq!(project_name_from_dir("/home/u/trailing/"), "trailing");
        assert_eq!(project_name_from_dir(""), "");
    }

    /// is_state_db_related：主库 + WAL/SHM 边车 → true；其它 → false。
    #[test]
    fn state_db_related_matches_sidecars() {
        let db = Path::new("/data/hermes/state.db");
        assert!(is_state_db_related(Path::new("/data/hermes/state.db"), db));
        assert!(is_state_db_related(Path::new("/data/hermes/state.db-wal"), db));
        assert!(is_state_db_related(Path::new("/data/hermes/state.db-shm"), db));
        // 不同目录同名 → false
        assert!(!is_state_db_related(Path::new("/other/state.db-wal"), db));
        // 无关文件 → false
        assert!(!is_state_db_related(Path::new("/data/hermes/other.txt"), db));
    }

    /// classify_event：state.db 及边车 → FullRescan；无关 → Ignore。
    /// 用 dirs 真实路径不便于测，这里直接测纯函数 is_state_db_related 已覆盖；
    /// 此处补测无关路径经 provider 走到 Ignore（state_db_path 一定返回某候选）。
    #[test]
    fn classify_ignores_unrelated() {
        let provider = HermesProvider;
        assert_eq!(
            provider.classify_event(Path::new("/totally/unrelated/file.jsonl")),
            EventKind::Ignore
        );
    }

    /// scan_one 恒 None（单库变更无法定位单会话）。
    #[test]
    fn scan_one_is_none() {
        let provider = HermesProvider;
        assert!(provider.scan_one(Path::new("/x/state.db")).is_none());
    }

    /// resume_argv：session_id 保持独立 argv 元素，含元字符也不被拆。
    #[test]
    fn resume_argv_keeps_session_id_single() {
        let provider = HermesProvider;
        let argv = provider.resume_argv("/proj", "x; rm -rf /");
        assert_eq!(argv, vec!["hermes", "--resume", "x; rm -rf /"]);
    }

    /// resume_command 字符串格式（v1，未核实）。
    #[test]
    fn resume_command_format() {
        let provider = HermesProvider;
        assert_eq!(
            provider.resume_command("/p", "sid_abc"),
            "hermes --resume sid_abc"
        );
    }
}
