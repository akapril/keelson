// providers/antigravity.rs — Antigravity（Google 的 agy CLI）会话 provider。
//
// **列表级接入**：Antigravity 的会话正文存在 per-conversation 的
// `conversations/<id>.db` 里，且为**私有 protobuf 格式**，无法可靠解析。
// 因此本 provider 只做「列出 + 归属 + resume」三件事：
//   - 从全局元数据库 `~/.gemini/antigravity-cli/conversation_summaries.db`
//     的 `conversation_summaries` 表读出会话清单（标题/预览/时间/工作区/步数）。
//   - 用 workspace_uris(file:// URI) 归属到项目。
//   - resume 靠 `agy --conversation <id>` 在终端恢复完整会话。
//
// 关键差异（相对其它 provider）：
// - 数据源是**单个** SQLite 元数据库（同 hermes 范式），只读打开。
// - **正文不可读**：user_messages 恒为空、by_model 恒空、total_tokens 恒 0；
//   first/last_prompt 用 preview 兜底，read_timeline 只回一条说明性消息。
// - 单库变更难映射到单会话 → classify_event 一律 FullRescan、scan_one 恒 None。
// - **始终只读打开**（OpenFlags::SQLITE_OPEN_READ_ONLY）：agy 可能正开着库，
//   WAL 模式下并发只读安全，且绝不写入用户数据。

use super::{EventKind, SessionProvider, WatchRoot};
use crate::models::{Session, TimelineMessage};
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OpenFlags};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// read_timeline 兜底说明（附在 preview 之后，让预览区不空白）。
const TIMELINE_NOTE: &str = "\n\n（Antigravity 会话正文为私有 protobuf 格式，暂仅列表级接入；\
可用 `agy --conversation <id>` 在终端恢复查看完整内容。）";

// ============================================================
// AntigravityProvider 主体
// ============================================================

pub struct AntigravityProvider;

impl SessionProvider for AntigravityProvider {
    fn id(&self) -> &'static str {
        "antigravity"
    }

    fn display_name(&self) -> &'static str {
        "Antigravity"
    }

    /// conversation_summaries.db 存在 → 视为可用。
    fn is_available(&self) -> bool {
        summaries_db_path().map(|p| p.exists()).unwrap_or(false)
    }

    /// 监听元数据库所在目录 `~/.gemini/antigravity-cli`。
    /// 就一个库文件（外加 WAL/SHM 边车），非递归即可（边车同目录）。
    fn watch_roots(&self) -> Vec<WatchRoot> {
        match summaries_db_path().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
            Some(dir) => vec![WatchRoot {
                path: dir,
                recursive: false,
            }],
            None => Vec::new(),
        }
    }

    /// 探测路径：conversation_summaries.db 本身（用于定期轮询）。
    fn refresh_probe_paths(&self) -> Vec<PathBuf> {
        match summaries_db_path() {
            Some(p) => vec![p],
            None => Vec::new(),
        }
    }

    /// 全量扫描：只读打开元数据库，读出所有会话。
    fn scan_all(&self) -> Vec<Session> {
        let db = match summaries_db_path() {
            Some(p) => p,
            None => return Vec::new(),
        };
        let conn = match open_readonly(&db) {
            Some(c) => c,
            None => return Vec::new(),
        };
        scan_all_from_conn(&conn)
    }

    /// 事件分类：路径是 conversation_summaries.db 或其 WAL/SHM 边车 → FullRescan
    /// （单库变更难映射到单会话）；否则 Ignore。
    fn classify_event(&self, path: &Path) -> EventKind {
        let db = match summaries_db_path() {
            Some(p) => p,
            None => return EventKind::Ignore,
        };
        if is_summaries_db_related(path, &db) {
            EventKind::FullRescan
        } else {
            EventKind::Ignore
        }
    }

    /// 增量扫描：元数据库变更无法定位到单会话 → 返回 None，
    /// 由 classify_event 的 FullRescan 覆盖。
    fn scan_one(&self, _path: &Path) -> Option<Session> {
        None
    }

    /// 生成 Antigravity 会话恢复命令（字符串版）。
    /// agy 二进制常不在 PATH（装在 `%LOCALAPPDATA%\agy\bin\agy.exe`），
    /// 故解析全路径后拼命令；解析不到则回退裸名 `agy`。
    /// 已核实：agy 支持 `--conversation <id>` 按 ID 恢复。
    fn resume_command(&self, _project_path: &str, session_id: &str) -> String {
        format!("{} --conversation {}", agy_binary(), session_id)
    }

    /// argv 版恢复命令：`[<agy>, "--conversation", <session_id>]`。
    /// - `<agy>`：优先 `%LOCALAPPDATA%\agy\bin\agy.exe` 全路径（存在时），否则裸名 `agy`。
    /// - session_id 作独立 argv 元素，web 侧直传 CommandBuilder、不经 shell → 无注入面。
    fn resume_argv(&self, _project_path: &str, session_id: &str) -> Vec<String> {
        vec![
            agy_binary(),
            "--conversation".to_string(),
            session_id.to_string(),
        ]
    }

    /// 新建会话：在项目目录起一个全新 agy 会话。默认实现会用 id（"antigravity"）作命令、
    /// 但 antigravity 的二进制是 agy 且常不在 PATH，故覆写为 agy 全路径。
    /// initial_prompt 忽略（纯起交互会话；agy 无对应参数）。
    fn start_command(&self, _initial_prompt: Option<&str>) -> String {
        agy_binary()
    }
    fn start_argv(&self, _initial_prompt: Option<&str>) -> Vec<String> {
        vec![agy_binary()]
    }

    /// 读取时间轴：正文不可解析 → 只回**单条**说明性消息，
    /// 用该会话 preview + 私有格式说明，让预览区有内容、不空白。
    fn read_timeline(&self, session_id: &str) -> Vec<TimelineMessage> {
        let db = match summaries_db_path() {
            Some(p) => p,
            None => return single_note_timeline("", ""),
        };
        let conn = match open_readonly(&db) {
            Some(c) => c,
            None => return single_note_timeline("", ""),
        };
        // 查该会话的 preview 与 last_modified_time（供说明消息展示）
        let (preview, last_modified) = fetch_preview_and_time(&conn, session_id);
        single_note_timeline(&preview, &last_modified)
    }
}

// ============================================================
// 元数据库定位 / 只读打开
// ============================================================

/// 全局元数据库路径：`~/.gemini/antigravity-cli/conversation_summaries.db`。
/// Windows 也是 home 下的 .gemini（非 LOCALAPPDATA）。
fn summaries_db_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| {
        home.join(".gemini")
            .join("antigravity-cli")
            .join("conversation_summaries.db")
    })
}

/// agy 二进制路径：Windows 装在 `%LOCALAPPDATA%\agy\bin\agy.exe`。
/// 该全路径存在则用之，否则回退裸名 `agy`（依赖 PATH）。
fn agy_binary() -> String {
    if let Some(local) = dirs::data_local_dir() {
        let exe = local.join("agy").join("bin").join("agy.exe");
        if exe.exists() {
            return exe.to_string_lossy().into_owned();
        }
    }
    "agy".to_string()
}

/// 判断路径是否为 conversation_summaries.db 或其 WAL/SHM 边车文件。
/// 纯函数：便于 standalone 单测。
fn is_summaries_db_related(path: &Path, db: &Path) -> bool {
    if path == db {
        return true;
    }
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
    // 只读列表所需列。killed='1' 的会话也列出（后续如需过滤再加 WHERE killed='0'）。
    let mut stmt = match conn.prepare(
        "SELECT conversation_id, title, preview, step_count, \
                last_modified_time, workspace_uris \
         FROM conversation_summaries",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = stmt.query_map([], |row| {
        Ok(AntigravityRow {
            conversation_id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            preview: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            step_count: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            last_modified_time: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            workspace_uris: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
        })
    });

    let rows = match rows {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let mut sessions: Vec<Session> = rows.flatten().map(row_to_session).collect();
    // 按更新时间降序（最新在前），同其它 provider
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    sessions
}

/// conversation_summaries 一行的原始数据（转换成 Session 前的中间态）。
/// step_count 在样本里是**文本**（如 '216'），故按 String 读再解析。
struct AntigravityRow {
    conversation_id: String,
    title: String,
    preview: String,
    step_count: String,
    last_modified_time: String,
    workspace_uris: String,
}

/// 把 conversation_summaries 一行组装成 Session。
fn row_to_session(r: AntigravityRow) -> Session {
    // project_path：解析 workspace_uris(JSON 数组) 第一个 file:// URI
    let project_path = parse_workspace_uri(&r.workspace_uris).unwrap_or_default();
    let project_name = project_name_from_dir(&project_path);

    // title 非空用它，否则 preview，再否则 conversation_id
    let title = if !r.title.trim().is_empty() {
        r.title.clone()
    } else if !r.preview.trim().is_empty() {
        r.preview.clone()
    } else {
        r.conversation_id.clone()
    };

    // 时间：解析 last_modified_time（`YYYY-MM-DD HH:MM:SS.fffffff+00:00`）
    let time = parse_antigravity_time(&r.last_modified_time).unwrap_or_else(Utc::now);

    // message_count = step_count（文本→u32，失败 0）
    let message_count = r.step_count.trim().parse::<u32>().unwrap_or(0);

    Session {
        session_id: r.conversation_id,
        provider: "antigravity".to_string(),
        project_path,
        project_name,
        // 正文读不了：first/last_prompt 都用 preview 兜底展示（供搜索/列表标题）
        first_prompt: title.clone(),
        last_prompt: r.preview,
        created_at: time,
        updated_at: time,
        message_count,
        // 无正文可搜 → 空 vec
        user_messages: Vec::new(),
        // 无 token 计量
        total_tokens: 0,
        by_model: HashMap::new(),
    }
}

/// 查单会话的 preview 与 last_modified_time（供 read_timeline 说明消息）。
/// 查不到 → 返回空串。
fn fetch_preview_and_time(conn: &Connection, session_id: &str) -> (String, String) {
    let sql = "SELECT preview, last_modified_time FROM conversation_summaries \
               WHERE conversation_id = ? LIMIT 1";
    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return (String::new(), String::new()),
    };
    let row = stmt.query_row([session_id], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        ))
    });
    row.unwrap_or_else(|_| (String::new(), String::new()))
}

/// 构造单条说明性时间轴消息：preview（若有）+ 私有格式说明。
/// timestamp 用解析后的时间（RFC3339），解析失败则用原始串。
fn single_note_timeline(preview: &str, last_modified: &str) -> Vec<TimelineMessage> {
    let content = if preview.trim().is_empty() {
        // 查不到 preview → 只放说明句（去掉前导换行）
        TIMELINE_NOTE.trim_start().to_string()
    } else {
        format!("{}{}", preview, TIMELINE_NOTE)
    };
    // 时间戳：解析成功用 RFC3339，否则原样（可能为空）
    let ts = match parse_antigravity_time(last_modified) {
        Some(dt) => dt.to_rfc3339(),
        None => last_modified.to_string(),
    };
    vec![TimelineMessage {
        role: "assistant".to_string(),
        content,
        timestamp: ts,
    }]
}

// ============================================================
// 纯函数辅助（可 standalone 单测）
// ============================================================

/// 解析 workspace_uris(JSON 数组)，取第一个 file:// URI 并规整成本地路径。
/// 例：`["file:///d:/workspace/exam-tools"]` → `Some("d:/workspace/exam-tools")`。
///
/// 处理步骤：
/// 1. JSON 解析取数组第一个字符串（非数组/空数组/解析失败 → None）。
/// 2. 去掉 `file://` 前缀。
/// 3. URL-decode（如 `%20` → 空格）。
/// 4. 去掉盘符前多余的前导 `/`（`/d:/x` → `d:/x`）；非盘符路径（`/home/u`）保留。
fn parse_workspace_uri(s: &str) -> Option<String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }
    // 解析 JSON 数组，取第一个字符串元素
    let arr: Vec<String> = serde_json::from_str(trimmed).ok()?;
    let first = arr.into_iter().find(|u| !u.trim().is_empty())?;

    // 去 file:// 前缀（file:///d:/... → /d:/...）
    let without_scheme = first
        .strip_prefix("file://")
        .unwrap_or(&first)
        .to_string();

    // URL-decode（尽力而为）
    let decoded = url_decode(&without_scheme);

    Some(normalize_local_path(&decoded))
}

/// 规整从 file:// URI 得到的本地路径：
/// - Windows 盘符形式 `/d:/x` → 去前导 `/` 得 `d:/x`（不强制转反斜杠）。
/// - `/D:/x` 同理（大写盘符）。
/// - 普通 Unix 路径 `/home/u` 保持不变。
fn normalize_local_path(p: &str) -> String {
    let bytes = p.as_bytes();
    // 形如 "/X:/..." 或 "/X:"（X 为字母）→ 去掉前导 '/'
    if bytes.len() >= 3
        && bytes[0] == b'/'
        && bytes[1].is_ascii_alphabetic()
        && bytes[2] == b':'
    {
        return p[1..].to_string();
    }
    p.to_string()
}

/// 最小 URL-decode（percent-decode）：把 `%HH` 还原为字节，其余原样。
/// 非法/不完整的 `%` 序列原样保留。项目未引入 urlencoding crate，手写足够。
fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = hex_val(bytes[i + 1]);
            let lo = hex_val(bytes[i + 2]);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    // 解码后按 UTF-8 还原；非法字节退回原串
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

/// 单个十六进制字符 → 数值（0-15），非 hex 返回 None。
fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// 解析 Antigravity 的时间戳字符串 → DateTime<Utc>。
/// 真实格式：`YYYY-MM-DD HH:MM:SS.fffffff+00:00`
///   - **空格**分隔日期与时间（非 'T'）。
///   - 小数位数**可变**（样本 7 位，容错任意位）。
///   - 带时区偏移（`+00:00`）。
/// 策略：把首个空格换成 'T' 得 RFC3339，再用 chrono 解析。
/// 无效值（如 `0001-01-01...`）虽能解析，但调用方对 last_user_input_time 会另行忽略；
/// 空串/解析失败 → None。
fn parse_antigravity_time(s: &str) -> Option<DateTime<Utc>> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }
    // 空格 → 'T'（只替换第一个，避免误伤时区里可能的空格——实际没有）
    let rfc = replace_first_space_with_t(trimmed);
    // RFC3339 解析（带时区偏移）→ 统一到 Utc
    DateTime::parse_from_rfc3339(&rfc)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// 把字符串里第一个空格替换成 'T'（用于日期时间归一化）。无空格则原样返回。
fn replace_first_space_with_t(s: &str) -> String {
    match s.find(' ') {
        Some(idx) => {
            let mut out = String::with_capacity(s.len());
            out.push_str(&s[..idx]);
            out.push('T');
            out.push_str(&s[idx + 1..]);
            out
        }
        None => s.to_string(),
    }
}

/// 从工作目录取项目名（最后一段）。兼容 Windows(`\`) 与 Unix(`/`) 分隔符。
fn project_name_from_dir(dir: &str) -> String {
    let trimmed = dir.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed.rsplit(['/', '\\']).next().unwrap_or("").to_string()
}

// ============================================================
// 单元测试（TDD）：用 rusqlite 建临时元数据库，插样本后断言映射。
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// 建内存库并造出 conversation_summaries 表（仅本 provider 用到的列 + 若干真实列）。
    fn make_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE conversation_summaries (
                conversation_id TEXT PRIMARY KEY,
                title TEXT,
                preview TEXT,
                step_count TEXT,
                last_modified_time TEXT,
                workspace_uris TEXT,
                status TEXT,
                project_id TEXT,
                parent_conversation_id TEXT,
                last_user_input_time TEXT,
                killed TEXT,
                app_data_dir TEXT
             );",
        )
        .unwrap();
        conn
    }

    /// 造 2 行：一行 title 为空(验回退 preview)、一行 title 非空。
    fn seed(conn: &Connection) {
        // 真实样式：title 为空 → 用 preview；workspace_uris 为 file:// URI；step_count 文本
        conn.execute(
            "INSERT INTO conversation_summaries \
                (conversation_id, title, preview, step_count, last_modified_time, workspace_uris, killed) \
             VALUES (?, '', 'Project Analysis', '216', \
                 '2025-11-24 06:16:20.5053042+00:00', \
                 '[\"file:///d:/workspace/exam-tools\"]', '0')",
            ["74580eaf-47b9-4f1f-bc1f-dd725d1c0825"],
        )
        .unwrap();
        // title 非空 → 用 title；更早的时间，验排序（更新时间降序 → 此行在后）
        conn.execute(
            "INSERT INTO conversation_summaries \
                (conversation_id, title, preview, step_count, last_modified_time, workspace_uris, killed) \
             VALUES ('abc-002', '重构任务', '预览文本', '3', \
                 '2025-11-20 10:00:00.1234567+00:00', \
                 '[\"file:///c:/proj/app\"]', '0')",
            [],
        )
        .unwrap();
    }

    /// TDD：scan_all 从库读出 2 会话并按时间降序，断言字段映射。
    #[test]
    fn scan_all_maps_session_fields() {
        let conn = make_db();
        seed(&conn);
        let sessions = scan_all_from_conn(&conn);
        assert_eq!(sessions.len(), 2);

        // 时间降序：74580eaf(11-24) 在前，abc-002(11-20) 在后
        let s = &sessions[0];
        assert_eq!(s.session_id, "74580eaf-47b9-4f1f-bc1f-dd725d1c0825");
        assert_eq!(s.provider, "antigravity");
        // project_path 从 file:///d:/... → d:/workspace/exam-tools
        assert_eq!(s.project_path, "d:/workspace/exam-tools");
        assert_eq!(s.project_name, "exam-tools");
        // title 为空 → first_prompt 回退 preview
        assert_eq!(s.first_prompt, "Project Analysis");
        // last_prompt 恒为 preview
        assert_eq!(s.last_prompt, "Project Analysis");
        // message_count = step_count(文本 216)
        assert_eq!(s.message_count, 216);
        // 正文不可读：无 token、无 user 消息
        assert_eq!(s.total_tokens, 0);
        assert!(s.user_messages.is_empty());
        assert!(s.by_model.is_empty());
        // created_at 解析正确（等于纯函数解析结果）
        assert_eq!(
            s.created_at,
            parse_antigravity_time("2025-11-24 06:16:20.5053042+00:00").unwrap()
        );
        assert_eq!(s.created_at, s.updated_at);

        // 第二行：title 非空 → first_prompt 用 title
        let s2 = &sessions[1];
        assert_eq!(s2.session_id, "abc-002");
        assert_eq!(s2.first_prompt, "重构任务");
        assert_eq!(s2.last_prompt, "预览文本");
        assert_eq!(s2.project_path, "c:/proj/app");
        assert_eq!(s2.message_count, 3);
    }

    /// parse_workspace_uri：真实样本 + 多种形态。
    #[test]
    fn workspace_uri_parses() {
        // Windows 盘符：去 file:// + 去前导 '/'
        assert_eq!(
            parse_workspace_uri(r#"["file:///d:/workspace/exam-tools"]"#),
            Some("d:/workspace/exam-tools".to_string())
        );
        // URL-decode：%20 → 空格
        assert_eq!(
            parse_workspace_uri(r#"["file:///d:/my%20proj"]"#),
            Some("d:/my proj".to_string())
        );
        // Unix 路径：保留前导 '/'
        assert_eq!(
            parse_workspace_uri(r#"["file:///home/u/proj"]"#),
            Some("/home/u/proj".to_string())
        );
        // 取数组第一个
        assert_eq!(
            parse_workspace_uri(r#"["file:///c:/a","file:///c:/b"]"#),
            Some("c:/a".to_string())
        );
        // 空数组 / 空串 / 非法 JSON → None
        assert_eq!(parse_workspace_uri("[]"), None);
        assert_eq!(parse_workspace_uri(""), None);
        assert_eq!(parse_workspace_uri("not json"), None);
    }

    /// parse_antigravity_time：真实样本（空格分隔 + 7 位小数 + 时区）。
    #[test]
    fn antigravity_time_parses() {
        // 真实样本
        let dt = parse_antigravity_time("2025-11-24 06:16:20.5053042+00:00").unwrap();
        assert_eq!(dt.timestamp(), 1763964980); // 2025-11-24T06:16:20Z
        // 小数位数可变：3 位也要成
        assert!(parse_antigravity_time("2025-11-24 06:16:20.505+00:00").is_some());
        // 无小数
        assert!(parse_antigravity_time("2025-11-24 06:16:20+00:00").is_some());
        // 非零时区偏移
        let dt2 = parse_antigravity_time("2025-11-24 08:16:20.0+02:00").unwrap();
        assert_eq!(dt2.timestamp(), 1763964980); // 归一到 UTC 与上面同刻
        // 空串 / 垃圾 → None
        assert!(parse_antigravity_time("").is_none());
        assert!(parse_antigravity_time("garbage").is_none());
    }

    /// read_timeline 逻辑：单条说明消息（含 preview + 说明）。
    #[test]
    fn timeline_returns_single_note() {
        let msgs = single_note_timeline("Project Analysis", "2025-11-24 06:16:20.5053042+00:00");
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, "assistant");
        assert!(msgs[0].content.starts_with("Project Analysis"));
        assert!(msgs[0].content.contains("agy --conversation"));
        // 时间戳解析成 RFC3339
        assert!(msgs[0].timestamp.starts_with("2025-11-24T06:16:20"));

        // 无 preview → 只放说明句
        let msgs2 = single_note_timeline("", "");
        assert_eq!(msgs2.len(), 1);
        assert!(msgs2[0].content.contains("私有 protobuf"));
        assert!(!msgs2[0].content.starts_with('\n'));
    }

    /// project_name：Windows/Unix 分隔符都要处理。
    #[test]
    fn project_name_both_separators() {
        assert_eq!(project_name_from_dir("d:/workspace/exam-tools"), "exam-tools");
        assert_eq!(project_name_from_dir("C:\\Users\\dev\\app"), "app");
        assert_eq!(project_name_from_dir("/home/u/trailing/"), "trailing");
        assert_eq!(project_name_from_dir(""), "");
    }

    /// is_summaries_db_related：主库 + WAL/SHM 边车 → true；其它 → false。
    #[test]
    fn summaries_db_related_matches_sidecars() {
        let db = Path::new("/home/u/.gemini/antigravity-cli/conversation_summaries.db");
        assert!(is_summaries_db_related(db, db));
        assert!(is_summaries_db_related(
            Path::new("/home/u/.gemini/antigravity-cli/conversation_summaries.db-wal"),
            db
        ));
        assert!(is_summaries_db_related(
            Path::new("/home/u/.gemini/antigravity-cli/conversation_summaries.db-shm"),
            db
        ));
        // 不同目录同名 → false
        assert!(!is_summaries_db_related(
            Path::new("/other/conversation_summaries.db-wal"),
            db
        ));
        // 无关文件 → false
        assert!(!is_summaries_db_related(
            Path::new("/home/u/.gemini/antigravity-cli/other.txt"),
            db
        ));
    }

    /// classify_event：无关路径 → Ignore。
    #[test]
    fn classify_ignores_unrelated() {
        let provider = AntigravityProvider;
        assert_eq!(
            provider.classify_event(Path::new("/totally/unrelated/file.jsonl")),
            EventKind::Ignore
        );
    }

    /// scan_one 恒 None（单库变更无法定位单会话）。
    #[test]
    fn scan_one_is_none() {
        let provider = AntigravityProvider;
        assert!(provider
            .scan_one(Path::new("/x/conversation_summaries.db"))
            .is_none());
    }

    /// resume_argv：session_id 保持独立 argv 元素（元字符不被拆），子命令为 --conversation。
    #[test]
    fn resume_argv_keeps_session_id_single() {
        let provider = AntigravityProvider;
        let argv = provider.resume_argv("/proj", "x; rm -rf /");
        // agy_binary() 可能是全路径或裸名，只断言后两个元素稳定
        assert_eq!(argv.len(), 3);
        assert_eq!(argv[1], "--conversation");
        assert_eq!(argv[2], "x; rm -rf /");
    }
}
