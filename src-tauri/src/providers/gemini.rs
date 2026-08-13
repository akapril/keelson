// providers/gemini.rs — Gemini CLI provider，照 opencode.rs / codex.rs 范式移植
// Gemini 的会话数据与 codex/opencode 都不同（关键差异，勿套旧假设）：
// - 会话是**单个 JSON 对象文件**（不是 JSONL、也不是三层拆分）：
//   ~/.gemini/tmp/<key>/chats/session-<time>-<id>.json
// - <key> 可能是 64-hex 的 projectHash，也可能直接是项目名（如 rsoc-new）。
// - 消息 content 有**两种形状**：user 消息是数组 [{text}]，gemini 消息是纯字符串——两种都要处理。
// - token 与 model 直接内嵌在每条 gemini 消息里（tokens.total / model）。
//
// 项目归属核心：Gemini 的 projectHash = sha256(规范化路径)，
// 规范化 = 绝对路径 + 大写盘符 + 反斜杠（Windows）；Unix 无盘符则原样。
// 我们反向建 hash→path 映射（候选来自 ~/.gemini/projects.json 的键 和
// ~/.gemini/history/*/.project_root 文件内容），再据 session 的 projectHash 反查绝对路径。

use super::{truncate, EventKind, SessionProvider, WatchRoot};
use crate::models::{Session, TimelineMessage};
use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

/// 时间轴单条消息字符上限：对真实消息等于"不截断"，仅对病态巨型粘贴保留兜底（同 codex/opencode）。
const TIMELINE_MSG_CHARS: usize = 20000;

// ============================================================
// 内部模型：镜像 Gemini session JSON 对象
// ============================================================

/// session-*.json 顶层对象
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)]
struct GeminiSession {
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    #[serde(rename = "projectHash")]
    pub project_hash: Option<String>,
    #[serde(rename = "startTime")]
    pub start_time: Option<String>,
    #[serde(rename = "lastUpdated")]
    pub last_updated: Option<String>,
    pub kind: Option<String>,
    #[serde(default)]
    pub messages: Vec<GeminiMessage>,
}

/// 单条消息。content 两种形状（array/string）用 serde_json::Value 兼容后自行提取文本。
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)]
struct GeminiMessage {
    pub id: Option<String>,
    pub timestamp: Option<String>,
    /// 消息类型：user / gemini / info（info 跳过、不计入）
    #[serde(rename = "type")]
    pub msg_type: Option<String>,
    /// user 为数组 [{text}]，gemini 为纯字符串 —— 用 Value 承接再提取
    pub content: Option<serde_json::Value>,
    /// 仅 gemini 消息带 token 计数
    pub tokens: Option<GeminiTokens>,
    /// 仅 gemini 消息带模型名
    pub model: Option<String>,
    /// 工具调用列表：仅 gemini 消息可能带，元素含 name/args。用 Value 承接再提取。
    #[serde(rename = "toolCalls")]
    pub tool_calls: Option<serde_json::Value>,
}

/// gemini 消息的 token 明细（只用 total）
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)]
struct GeminiTokens {
    pub input: Option<u64>,
    pub output: Option<u64>,
    pub cached: Option<u64>,
    pub total: Option<u64>,
}

// ============================================================
// GeminiProvider 主体
// ============================================================

pub struct GeminiProvider;

impl SessionProvider for GeminiProvider {
    fn id(&self) -> &'static str {
        "gemini"
    }

    fn display_name(&self) -> &'static str {
        "Gemini CLI"
    }

    /// ~/.gemini/tmp 目录存在 或 gemini 二进制在 PATH → 视为可用
    fn is_available(&self) -> bool {
        tmp_root().map(|r| r.exists()).unwrap_or(false) || gemini_binary_exists()
    }

    /// 监听 ~/.gemini/tmp（递归）——各 <key>/chats/*.json 都在其下
    fn watch_roots(&self) -> Vec<WatchRoot> {
        match tmp_root() {
            Some(root) => vec![WatchRoot {
                path: root,
                recursive: true,
            }],
            None => Vec::new(),
        }
    }

    /// 探测路径：~/.gemini/tmp（用于定期轮询）
    fn refresh_probe_paths(&self) -> Vec<PathBuf> {
        match tmp_root() {
            Some(root) => vec![root],
            None => Vec::new(),
        }
    }

    /// 全量扫描：glob `~/.gemini/tmp/*/chats/session-*.json`，逐个解析成 Session
    fn scan_all(&self) -> Vec<Session> {
        let root = match tmp_root() {
            Some(r) => r,
            None => return Vec::new(),
        };
        // 建 projectHash → 绝对路径 的映射（一次建好复用，避免每个会话重复扫盘）
        let hash_map = build_hash_map();
        let mut sessions = Vec::new();
        // tmp/<key>/chats/session-*.json：两层目录遍历
        if let Ok(keys) = fs::read_dir(&root) {
            for key in keys.flatten() {
                let chats_dir = key.path().join("chats");
                if !chats_dir.is_dir() {
                    continue;
                }
                if let Ok(files) = fs::read_dir(&chats_dir) {
                    for f in files.flatten() {
                        let p = f.path();
                        if is_session_file(&p) {
                            if let Some(s) = scan_gemini_session(&p, &hash_map) {
                                sessions.push(s);
                            }
                        }
                    }
                }
            }
        }
        // 按更新时间降序排列（最新在前）
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        sessions
    }

    /// 事件分类：
    /// - 路径匹配 `.gemini/tmp/*/chats/session-*.json` → 增量扫描
    /// - 其他 → 忽略
    fn classify_event(&self, path: &Path) -> EventKind {
        if is_gemini_session_path(path) {
            EventKind::Incremental
        } else {
            EventKind::Ignore
        }
    }

    /// 增量扫描：直接重解析该 session 文件；解析不出返回 None
    fn scan_one(&self, path: &Path) -> Option<Session> {
        let hash_map = build_hash_map();
        scan_gemini_session(path, &hash_map)
    }

    /// 生成 Gemini 会话恢复命令。
    ///
    /// ⚠ 限制：Gemini 的 resume 是**索引制、不是 id 制**——CLI 仅支持
    /// `gemini --resume latest|<序号>`，**没有** `gemini --resume <sessionId>`，
    /// 因此无法按任意 sessionId 精确恢复某条历史会话。
    /// v1 折中：恢复"该项目最近一条"会话（web 终端会把 cwd 设为 project_path，
    /// gemini 据 cwd 定位到对应项目的 chats，latest 即该项目最新会话）。
    fn resume_command(&self, _project_path: &str, _session_id: &str) -> String {
        "gemini --resume latest".to_string()
    }

    /// argv 版恢复命令：`["gemini", "--resume", "latest"]`。
    ///
    /// 同 [`resume_command`](Self::resume_command) 的限制说明：索引制，无法按 sessionId 恢复，
    /// v1 固定用 `latest` 恢复项目最近会话（依赖 web 终端把 cwd 设为 project_path）。
    fn resume_argv(&self, _project_path: &str, _session_id: &str) -> Vec<String> {
        vec![
            "gemini".to_string(),
            "--resume".to_string(),
            "latest".to_string(),
        ]
    }

    /// 读取指定会话的时间轴消息列表
    fn read_timeline(&self, session_id: &str) -> Vec<TimelineMessage> {
        let root = match tmp_root() {
            Some(r) => r,
            None => return Vec::new(),
        };
        let path = match find_session_file(&root, session_id) {
            Some(p) => p,
            None => return Vec::new(),
        };
        read_gemini_timeline_from_path(&path)
    }
}

// ============================================================
// tmp 根定位（可移植探测；不硬编码个人路径）
// ============================================================

/// Gemini 会话根：`~/.gemini/tmp`（取不到 home 则 None）。
fn tmp_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".gemini").join("tmp"))
}

/// `~/.gemini` 根目录（projects.json / history 都在其下）。
fn gemini_home() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".gemini"))
}

/// 判断系统 PATH 中是否存在 gemini 二进制（is_available 的另一半判据）。
/// 复用统一的 PATH 探测（Windows 补 .exe/.cmd/.bat；不启子进程），避免多处重复实现。
fn gemini_binary_exists() -> bool {
    crate::commands::cli::bin_in_path("gemini")
}

// ============================================================
// 路径匹配（session 文件判定）
// ============================================================

/// 文件名是否形如 `session-*.json`（不含目录层级判断）。
fn is_session_file(path: &Path) -> bool {
    if path.extension().and_then(|e| e.to_str()) != Some("json") {
        return false;
    }
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with("session-"))
        .unwrap_or(false)
}

/// 完整路径是否形如 `.../.gemini/tmp/*/chats/session-*.json`（用于 classify_event）。
/// 检查父目录名为 `chats`、且父父父层含 `tmp`（其上一层为 `.gemini`），兼容 \ 与 /。
fn is_gemini_session_path(path: &Path) -> bool {
    if !is_session_file(path) {
        return false;
    }
    // 父目录须为 chats
    let parent = match path.parent() {
        Some(p) => p,
        None => return false,
    };
    if parent.file_name().and_then(|n| n.to_str()) != Some("chats") {
        return false;
    }
    // chats 的上级是 <key>，再上级须为 tmp
    let key_dir = match parent.parent() {
        Some(p) => p,
        None => return false,
    };
    key_dir
        .parent()
        .and_then(|tmp| tmp.file_name())
        .and_then(|n| n.to_str())
        == Some("tmp")
}

// ============================================================
// projectHash → 绝对路径 映射（项目归属核心）
// ============================================================

/// 规范化路径用于计算 Gemini projectHash：
/// - 若形如 `x:\...`（第 2 个字符是 `:`，Windows 盘符）→ 首字符大写，其余原样。
/// - 否则（Unix 绝对路径等）→ 原样返回。
/// 注意：仅做盘符大写，不改分隔符（样本已是反斜杠），避免误伤 Unix 路径。
fn normalize_project_path(p: &str) -> String {
    let bytes = p.as_bytes();
    // 第 2 字符为 ':' 视为 Windows 盘符路径（如 d:\... 或 D:\...）
    if bytes.len() >= 2 && bytes[1] == b':' {
        let mut chars: Vec<char> = p.chars().collect();
        chars[0] = chars[0].to_ascii_uppercase();
        chars.into_iter().collect()
    } else {
        p.to_string()
    }
}

/// 计算某路径的 Gemini projectHash = sha256(规范化路径) 的十六进制小写串。
fn gemini_hash(path: &str) -> String {
    let normalized = normalize_project_path(path);
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    hex::encode(hasher.finalize())
}

/// 建 projectHash → 绝对路径 映射。候选路径来自：
/// (a) `~/.gemini/projects.json` 的**键**（形如 `"d:\\workspace\\rsoc-new"`）
/// (b) 所有 `~/.gemini/history/*/.project_root` 文件内容
/// 对每个候选路径 P 计算 gemini_hash(P) 存入映射。全部失败返回空 map（不崩）。
fn build_hash_map() -> HashMap<String, String> {
    let mut map = HashMap::new();
    let home = match gemini_home() {
        Some(h) => h,
        None => return map,
    };

    // (a) projects.json 的键
    let projects_json = home.join("projects.json");
    if let Ok(text) = fs::read_to_string(&projects_json) {
        if let Ok(serde_json::Value::Object(obj)) = serde_json::from_str::<serde_json::Value>(&text)
        {
            for key in obj.keys() {
                if !key.trim().is_empty() {
                    map.entry(gemini_hash(key)).or_insert_with(|| key.clone());
                }
            }
        }
    }

    // (b) history/*/.project_root 文件内容
    let history_dir = home.join("history");
    if let Ok(entries) = fs::read_dir(&history_dir) {
        for e in entries.flatten() {
            let root_file = e.path().join(".project_root");
            if let Ok(content) = fs::read_to_string(&root_file) {
                let p = content.trim();
                if !p.is_empty() {
                    map.entry(gemini_hash(p)).or_insert_with(|| p.to_string());
                }
            }
        }
    }

    map
}

/// 兜底读取某会话所在 tmp_key 目录对应的 `~/.gemini/history/<key>/.project_root`。
/// （name 键目录常有此文件；hash 映射查不到时的第二策略。）
fn project_root_from_history(tmp_key: &str) -> Option<String> {
    let home = gemini_home()?;
    let root_file = home.join("history").join(tmp_key).join(".project_root");
    let content = fs::read_to_string(&root_file).ok()?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

// ============================================================
// 单个 session 解析
// ============================================================

/// 解析单个 Gemini 会话文件（单 JSON 对象）→ Session。
/// `hash_map` 为预建的 projectHash→绝对路径 映射，用于项目归属反查。
/// 供 scan_all / scan_one / 测试使用。
pub fn scan_gemini_session(path: &Path, hash_map: &HashMap<String, String>) -> Option<Session> {
    let sess: GeminiSession = read_json(path)?;
    let session_id = sess.session_id?;
    if session_id.is_empty() {
        return None;
    }
    let project_hash = sess.project_hash.unwrap_or_default();

    // 时间：RFC3339 解析（startTime/lastUpdated 形如 2026-03-05T03:45:27.111Z）
    let created_at = sess
        .start_time
        .as_deref()
        .and_then(parse_rfc3339)
        .unwrap_or_else(Utc::now);
    let updated_at = sess
        .last_updated
        .as_deref()
        .and_then(parse_rfc3339)
        .unwrap_or(created_at);

    // 项目归属：先查 hash 映射；查不到退而读该会话 tmp_key 的 history/.project_root。
    let tmp_key = tmp_key_from_path(path);
    let project_path = resolve_project_path(&project_hash, tmp_key.as_deref(), hash_map);
    // 归属不到 → project_name 用 gemini-<hash 前 8 位>，保证仍能分组、不崩。
    let project_name = if project_path.is_empty() {
        format!("gemini-{}", short_hash(&project_hash))
    } else {
        project_name_from_dir(&project_path)
    };

    // 遍历消息：按出现顺序提取 user 文本、统计计数/token/by_model；info 跳过不计。
    let mut user_messages: Vec<String> = Vec::new();
    let mut message_count: u32 = 0;
    let mut total_tokens: u64 = 0;
    let mut by_model: HashMap<String, u64> = HashMap::new();

    for m in &sess.messages {
        match m.msg_type.as_deref() {
            Some("user") => {
                message_count += 1;
                let text = extract_message_text(m.content.as_ref());
                // 空文本也占一条 user，但只有非空才进检索列表（与 codex/opencode 一致：非空才入）
                if !text.is_empty() {
                    user_messages.push(text);
                }
            }
            Some("gemini") => {
                message_count += 1;
                let t = m.tokens.as_ref().and_then(|tk| tk.total).unwrap_or(0);
                total_tokens += t;
                if let Some(model) = m.model.as_deref() {
                    if !model.is_empty() {
                        *by_model.entry(model.to_string()).or_insert(0) += t;
                    }
                }
            }
            // info 及其它类型：跳过，不计入 message_count
            _ => {}
        }
    }

    Some(Session {
        session_id,
        provider: "gemini".to_string(),
        project_path,
        project_name,
        first_prompt: user_messages.first().cloned().unwrap_or_default(),
        last_prompt: user_messages.last().cloned().unwrap_or_default(),
        created_at,
        updated_at,
        message_count,
        user_messages,
        total_tokens,
        by_model,
    })
}

/// 纯函数：从一个 Gemini `toolCalls` 元素生成时间线里的「工具调用」简洁描述。
/// 元素形如 `{"name":"read_file","args":{"file_path":"..."}}`。
/// 返回 `None` 表示无有效工具名。格式约定：
/// - read_file/write_file/replace → `"工具名: <file_path>"`
/// - run_shell_command → `"run_shell_command: <命令前若干字>"`（取 args.command）
/// - glob/grep_search/search_file_content → `"工具名: <pattern>"`
/// - google_web_search/tavily-search 等 → `"工具名: <query>"`
/// - 其它/取不到参数 → 仅工具名。
pub fn gemini_tool_summary(call: &serde_json::Value) -> Option<String> {
    let name = call.get("name").and_then(|v| v.as_str()).unwrap_or("");
    if name.is_empty() {
        return None;
    }
    let args = call.get("args");
    let str_arg = |key: &str| -> Option<String> {
        args.and_then(|a| a.get(key))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
    };
    // 依次尝试常见「目标」参数：文件 → 命令 → 模式 → 查询
    let target = str_arg("file_path")
        .or_else(|| str_arg("command"))
        .or_else(|| str_arg("pattern"))
        .or_else(|| str_arg("query"))
        .or_else(|| str_arg("url"));
    let summary = match target {
        Some(t) => format!("{}: {}", name, super::tool_target_summary(&t)),
        None => name.to_string(),
    };
    Some(summary)
}

/// 读取指定会话文件的时间轴消息列表：user/gemini → TimelineMessage，info 跳过，按顺序。
pub fn read_gemini_timeline_from_path(path: &Path) -> Vec<TimelineMessage> {
    let sess: GeminiSession = match read_json(path) {
        Some(s) => s,
        None => return Vec::new(),
    };
    let mut out = Vec::new();
    for m in &sess.messages {
        // 角色映射：user→user，gemini→assistant，其它（info 等）跳过
        let role = match m.msg_type.as_deref() {
            Some("user") => "user",
            Some("gemini") => "assistant",
            _ => continue,
        };
        let ts = format_timestamp(m.timestamp.as_deref().unwrap_or(""));
        // 先产出文本气泡（可能为空——纯工具调用回合）
        let text = extract_message_text(m.content.as_ref());
        if !text.is_empty() {
            out.push(TimelineMessage {
                role: role.to_string(),
                content: truncate(&text, TIMELINE_MSG_CHARS),
                timestamp: ts.clone(),
            });
        }
        // 再按顺序产出该消息里的工具调用条目（紧跟助手文本）
        if let Some(serde_json::Value::Array(calls)) = m.tool_calls.as_ref() {
            for call in calls {
                if let Some(summary) = gemini_tool_summary(call) {
                    out.push(TimelineMessage {
                        role: "tool".to_string(),
                        content: summary,
                        timestamp: ts.clone(),
                    });
                }
            }
        }
    }
    // 限制最大消息数，防止超大 IPC 响应。保留最近 500 条（同 codex/opencode）。
    if out.len() > 500 {
        out.drain(0..out.len() - 500);
    }
    out
}

// ============================================================
// 消息文本提取（兼容 array / string 两种形状）
// ============================================================

/// 从消息 content 提取纯文本：
/// - 数组 `[{text}]`（user 消息）→ 拼接各元素的 text 字段。
/// - 纯字符串（gemini 消息）→ 直接返回。
/// - 其它/缺失 → 空串。
fn extract_message_text(content: Option<&serde_json::Value>) -> String {
    match content {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(arr)) => {
            let mut buf = String::new();
            for item in arr {
                if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                    buf.push_str(t);
                }
            }
            buf
        }
        _ => String::new(),
    }
}

// ============================================================
// 路径 → tmp_key / 会话文件定位
// ============================================================

/// 从 session 文件路径取其所在的 `<key>` 目录名（tmp/<key>/chats/session-*.json 的 <key>）。
fn tmp_key_from_path(path: &Path) -> Option<String> {
    // path.parent()=chats，再 parent()=<key>
    let chats = path.parent()?;
    let key = chats.parent()?;
    key.file_name().and_then(|n| n.to_str()).map(String::from)
}

/// 解析项目绝对路径：
/// 1. 用 projectHash 查预建映射。
/// 2. 查不到则读该会话 tmp_key 的 `history/<key>/.project_root`。
/// 3. 都拿不到 → 返回空串（上层据此走 gemini-<hash前8> 兜底名）。
fn resolve_project_path(
    project_hash: &str,
    tmp_key: Option<&str>,
    hash_map: &HashMap<String, String>,
) -> String {
    if !project_hash.is_empty() {
        if let Some(p) = hash_map.get(project_hash) {
            return p.clone();
        }
    }
    if let Some(key) = tmp_key {
        if let Some(p) = project_root_from_history(key) {
            return p;
        }
    }
    String::new()
}

/// 在 `~/.gemini/tmp/*/chats/` 下按文件名含 session_id 定位会话文件。
fn find_session_file(root: &Path, session_id: &str) -> Option<PathBuf> {
    let keys = fs::read_dir(root).ok()?;
    for key in keys.flatten() {
        let chats_dir = key.path().join("chats");
        if !chats_dir.is_dir() {
            continue;
        }
        if let Ok(files) = fs::read_dir(&chats_dir) {
            for f in files.flatten() {
                let p = f.path();
                if !is_session_file(&p) {
                    continue;
                }
                // 文件名形如 session-<time>-<id>.json，含 session_id 即命中
                if p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.contains(session_id))
                    .unwrap_or(false)
                {
                    return Some(p);
                }
                // 兜底：文件名不含 id 时，读内容比对 sessionId
                if let Some(s) = read_json::<GeminiSession>(&p) {
                    if s.session_id.as_deref() == Some(session_id) {
                        return Some(p);
                    }
                }
            }
        }
    }
    None
}

// ============================================================
// 纯函数辅助（可 standalone 单测）
// ============================================================

/// 解析 RFC3339 / ISO 8601 时间串为 DateTime<Utc>（形如 2026-03-05T03:45:27.111Z）。
fn parse_rfc3339(s: &str) -> Option<DateTime<Utc>> {
    s.parse::<DateTime<Utc>>().ok()
}

/// 格式化时间戳为 HH:MM:SS（ISO 8601 可解析则取时分秒，否则原样返回）。
fn format_timestamp(ts: &str) -> String {
    match parse_rfc3339(ts) {
        Some(dt) => dt.format("%H:%M:%S").to_string(),
        None => ts.to_string(),
    }
}

/// projectHash 前 8 位（用于归属失败时的兜底项目名；空 hash → "unknown"）。
fn short_hash(hash: &str) -> String {
    if hash.is_empty() {
        "unknown".to_string()
    } else {
        hash.chars().take(8).collect()
    }
}

/// 从工作目录取项目名（最后一段目录名）。兼容 Windows(`\`) 与 Unix(`/`) 分隔符。
fn project_name_from_dir(dir: &str) -> String {
    let trimmed = dir.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed.rsplit(['/', '\\']).next().unwrap_or("").to_string()
}

/// 读并反序列化单个 JSON 文件（失败一律返回 None，容错优先）。
fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut buf = String::new();
    reader.read_to_string(&mut buf).ok()?;
    serde_json::from_str(&buf).ok()
}

// ============================================================
// 单元测试（TDD，仿 opencode.rs 的 #[cfg(test)]）
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 已知对：D:\workspace\rsoc-new → 该 sha256（题面已验证）。
    const RSOC_PATH: &str = "D:\\workspace\\rsoc-new";
    const RSOC_HASH: &str = "1a7ab1f5999a883d9b2080a1be47e4f0374e5d8f827c76b65d5f46020e84dcd3";

    /// gemini_hash：已知路径 → 已知 hash；小写盘符输入也应大写后命中同一 hash。
    #[test]
    fn gemini_hash_matches_known_pair() {
        assert_eq!(gemini_hash(RSOC_PATH), RSOC_HASH);
        // 小写盘符：normalize 应把 d: 大写为 D:，命中同一 hash
        assert_eq!(gemini_hash("d:\\workspace\\rsoc-new"), RSOC_HASH);
    }

    /// normalize：Windows 盘符大写；Unix 路径原样。
    #[test]
    fn normalize_uppercases_drive_letter_only() {
        assert_eq!(normalize_project_path("d:\\workspace\\rsoc-new"), "D:\\workspace\\rsoc-new");
        assert_eq!(normalize_project_path("D:\\already\\upper"), "D:\\already\\upper");
        // Unix 绝对路径：原样（不改分隔符、不动首字符）
        assert_eq!(normalize_project_path("/home/user/proj"), "/home/user/proj");
    }

    /// 在临时目录造一个 session-*.json：1 user + 2 gemini(带 tokens/model) + 1 info。
    /// user 用**数组** content，gemini 用**字符串** content —— 覆盖两种形状。
    /// 返回 (tempdir, session 文件路径, session_id)。
    fn make_fixture() -> (tempfile::TempDir, PathBuf, String) {
        let tmp = tempfile::tempdir().unwrap();
        let chats = tmp.path().join(RSOC_HASH).join("chats");
        fs::create_dir_all(&chats).unwrap();
        let sid = "fb954a49-1111-2222-3333-444455556666".to_string();
        let session_json = serde_json::json!({
            "sessionId": sid,
            "projectHash": RSOC_HASH,
            "startTime": "2026-03-05T03:45:27.111Z",
            "lastUpdated": "2026-03-05T09:37:47.271Z",
            "kind": "chat",
            "messages": [
                // user：content 为数组 [{text}]
                {
                    "id": "m1",
                    "timestamp": "2026-03-05T03:45:27.112Z",
                    "type": "user",
                    "content": [{ "text": "用户问题" }]
                },
                // gemini：content 为纯字符串，带 tokens/model
                {
                    "id": "m2",
                    "timestamp": "2026-03-05T03:45:30.000Z",
                    "type": "gemini",
                    "content": "助手回复一",
                    "tokens": { "input": 13267, "output": 194, "cached": 0, "total": 13461 },
                    "model": "gemini-3-flash-preview"
                },
                {
                    "id": "m3",
                    "timestamp": "2026-03-05T03:46:00.000Z",
                    "type": "gemini",
                    "content": "助手回复二",
                    "tokens": { "input": 100, "output": 39, "cached": 0, "total": 139 },
                    "model": "gemini-3-flash-preview"
                },
                // info：应被跳过、不计入
                {
                    "id": "m4",
                    "timestamp": "2026-03-05T03:46:10.000Z",
                    "type": "info",
                    "content": "some info"
                }
            ]
        });
        let file = chats.join(format!("session-20260305-{}.json", sid));
        fs::write(&file, serde_json::to_string(&session_json).unwrap()).unwrap();
        (tmp, file, sid)
    }

    /// TDD：扫描单会话，断言字段映射正确（含 content 两种形状、info 不计、token 累加）。
    #[test]
    fn scan_one_parses_gemini_fixture() {
        let (_tmp, file, sid) = make_fixture();
        // hash 映射：把 RSOC_HASH → RSOC_PATH，验证项目归属反查
        let mut hash_map = HashMap::new();
        hash_map.insert(RSOC_HASH.to_string(), RSOC_PATH.to_string());

        let session = scan_gemini_session(&file, &hash_map).expect("应成功解析为 Session");

        assert_eq!(session.session_id, sid);
        assert_eq!(session.provider, "gemini");
        // 项目归属：hash 映射命中 → project_path = 绝对路径
        assert_eq!(session.project_path, RSOC_PATH);
        assert_eq!(session.project_name, "rsoc-new");
        // message_count = user(1) + gemini(2) = 3；info 不计
        assert_eq!(session.message_count, 3);
        // 用户消息仅一条，content 数组形状取到文本
        assert_eq!(session.user_messages.len(), 1);
        assert_eq!(session.first_prompt, "用户问题");
        assert_eq!(session.last_prompt, "用户问题");
        // total_tokens = 13461 + 139 = 13600
        assert_eq!(session.total_tokens, 13600);
        // by_model：同一模型累加两条 gemini 的 total
        assert_eq!(session.by_model.get("gemini-3-flash-preview"), Some(&13600u64));
        // Σ by_model == total_tokens
        assert_eq!(session.by_model.values().sum::<u64>(), session.total_tokens);
        // created_at / updated_at 从 RFC3339 解析
        assert_eq!(session.created_at, parse_rfc3339("2026-03-05T03:45:27.111Z").unwrap());
        assert_eq!(session.updated_at, parse_rfc3339("2026-03-05T09:37:47.271Z").unwrap());
    }

    /// 项目归属失败（hash 映射空、无 history）→ project_path 空、name 用 gemini-<前8>。
    #[test]
    fn scan_one_falls_back_when_hash_unknown() {
        let (_tmp, file, _sid) = make_fixture();
        let empty: HashMap<String, String> = HashMap::new();
        let session = scan_gemini_session(&file, &empty).expect("仍应解析成功");
        assert_eq!(session.project_path, "");
        // gemini-<hash 前 8 位>
        assert_eq!(session.project_name, format!("gemini-{}", &RSOC_HASH[..8]));
    }

    /// 时间轴：user + 2 gemini 三条，按顺序；info 跳过；content 两种形状都取到文本。
    #[test]
    fn read_timeline_from_fixture() {
        let (_tmp, file, _sid) = make_fixture();
        let msgs = read_gemini_timeline_from_path(&file);
        assert_eq!(msgs.len(), 3, "应有 3 条时间轴消息（1 user + 2 gemini），info 跳过");
        assert_eq!(msgs[0].role, "user");
        assert_eq!(msgs[0].content, "用户问题");
        assert_eq!(msgs[1].role, "assistant");
        assert_eq!(msgs[1].content, "助手回复一");
        assert_eq!(msgs[2].role, "assistant");
        assert_eq!(msgs[2].content, "助手回复二");
    }

    /// gemini_tool_summary：read_file 取 file_path，run_shell_command 取 command，
    /// 检索类取 pattern/query，未知/无参数退回工具名。
    #[test]
    fn tool_summary_picks_target_arg() {
        let read = serde_json::json!({"name":"read_file","args":{"file_path":"/a.rs"}});
        assert_eq!(gemini_tool_summary(&read).unwrap(), "read_file: /a.rs");
        let sh = serde_json::json!({"name":"run_shell_command","args":{"command":"ls\n-la","description":"x"}});
        assert_eq!(gemini_tool_summary(&sh).unwrap(), "run_shell_command: ls -la");
        let grep = serde_json::json!({"name":"grep_search","args":{"pattern":"foo","dir_path":"/x"}});
        assert_eq!(gemini_tool_summary(&grep).unwrap(), "grep_search: foo");
        let search = serde_json::json!({"name":"google_web_search","args":{"query":"rust"}});
        assert_eq!(gemini_tool_summary(&search).unwrap(), "google_web_search: rust");
        let todos = serde_json::json!({"name":"write_todos","args":{"todos":[]}});
        assert_eq!(gemini_tool_summary(&todos).unwrap(), "write_todos");
        let noname = serde_json::json!({"args":{"file_path":"/a"}});
        assert!(gemini_tool_summary(&noname).is_none());
    }

    /// 时间线：gemini 消息带 toolCalls → 文本气泡后紧跟 role="tool" 条目，保持顺序。
    #[test]
    fn timeline_includes_gemini_tool_entries() {
        let obj = serde_json::json!({
            "sessionId": "s1",
            "messages": [
                {"type":"user","timestamp":"2026-08-13T10:00:00Z","content":[{"text":"读文件"}]},
                {"type":"gemini","timestamp":"2026-08-13T10:00:01Z","content":"我来读",
                 "toolCalls":[{"name":"read_file","args":{"file_path":"/x.rs"}}]}
            ]
        });
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("session-x.json");
        std::fs::write(&file, serde_json::to_string(&obj).unwrap()).unwrap();
        let msgs = read_gemini_timeline_from_path(&file);
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0].role, "user");
        assert_eq!(msgs[1].role, "assistant");
        assert_eq!(msgs[1].content, "我来读");
        assert_eq!(msgs[2].role, "tool");
        assert_eq!(msgs[2].content, "read_file: /x.rs");
    }

    /// extract_message_text：数组拼各 text；字符串直接用；其它形状 → 空。
    #[test]
    fn extract_text_handles_both_shapes() {
        let arr = serde_json::json!([{ "text": "你好" }, { "text": "世界" }]);
        assert_eq!(extract_message_text(Some(&arr)), "你好世界");
        let s = serde_json::json!("纯字符串");
        assert_eq!(extract_message_text(Some(&s)), "纯字符串");
        let n = serde_json::json!(123);
        assert_eq!(extract_message_text(Some(&n)), "");
        assert_eq!(extract_message_text(None), "");
    }

    /// resume_argv：v1 固定 ["gemini","--resume","latest"]（索引制，非 id 制）。
    #[test]
    fn resume_argv_is_latest() {
        let provider = GeminiProvider;
        let argv = provider.resume_argv("D:\\workspace\\rsoc-new", "任意-session-id");
        assert_eq!(argv, vec!["gemini", "--resume", "latest"]);
    }

    /// resume_command 字符串格式。
    #[test]
    fn resume_command_format() {
        let provider = GeminiProvider;
        assert_eq!(
            provider.resume_command("D:\\workspace\\rsoc-new", "任意-session-id"),
            "gemini --resume latest"
        );
    }

    /// classify_event：.gemini/tmp/<key>/chats/session-*.json → Incremental；无关路径 → Ignore。
    #[test]
    fn classify_event_inside_chats_is_incremental() {
        let provider = GeminiProvider;
        // 构造形如 .../.gemini/tmp/<key>/chats/session-*.json
        let inside = Path::new("/home/u/.gemini/tmp")
            .join(RSOC_HASH)
            .join("chats")
            .join("session-20260305-abc.json");
        assert_eq!(provider.classify_event(&inside), EventKind::Incremental);

        // 非 chats 目录 → Ignore
        let not_chats = Path::new("/home/u/.gemini/tmp")
            .join(RSOC_HASH)
            .join("other")
            .join("session-x.json");
        assert_eq!(provider.classify_event(&not_chats), EventKind::Ignore);

        // 非 session- 前缀 → Ignore
        let not_session = Path::new("/home/u/.gemini/tmp")
            .join(RSOC_HASH)
            .join("chats")
            .join("notes.json");
        assert_eq!(provider.classify_event(&not_session), EventKind::Ignore);

        // 完全无关 → Ignore
        assert_eq!(
            provider.classify_event(Path::new("/some/other/path.txt")),
            EventKind::Ignore
        );
    }

    /// tmp_key_from_path：从 session 路径取 <key> 目录名。
    #[test]
    fn tmp_key_from_path_extracts_key() {
        let p = Path::new("/root/.gemini/tmp")
            .join("mykey123")
            .join("chats")
            .join("session-x.json");
        assert_eq!(tmp_key_from_path(&p), Some("mykey123".to_string()));
    }

    /// project_name_from_dir：Windows/Unix 分隔符都要处理。
    #[test]
    fn project_name_handles_both_separators() {
        assert_eq!(project_name_from_dir("D:\\workspace\\rsoc-new"), "rsoc-new");
        assert_eq!(project_name_from_dir("/home/user/myproject"), "myproject");
        assert_eq!(project_name_from_dir("/home/user/trailing/"), "trailing");
        assert_eq!(project_name_from_dir(""), "");
    }
}
