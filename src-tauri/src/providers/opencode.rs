// providers/opencode.rs — OpenCode CLI provider，照 codex.rs 范式移植
// OpenCode 会话不是单 JSONL，而是拆成三层 JSON 文件（只读 JSON，绝不碰 SQLite）：
// - storage/session/<projectID>/<session_id>.json → 会话元信息（id/directory/title/time）
// - storage/message/<session_id>/<message_id>.json → 单条消息（role/time/model）
// - storage/part/<message_id>/<part_id>.json       → 消息正文分片（只取 type=="text" 的 text）
//
// 关键差异（相对 codex）：
// - 时间是 epoch 毫秒（需自行转 DateTime<Utc>），codex 是 ISO 8601 字符串。
// - token 计数只在 SQLite 里，本次不读 → total_tokens=0、by_model 留空。

use super::{truncate, EventKind, SessionProvider, WatchRoot};
use crate::models::{Session, TimelineMessage};
use chrono::{DateTime, TimeZone, Utc};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

/// 时间轴单条消息字符上限：对真实消息等于"不截断"，仅对病态巨型粘贴保留兜底（同 codex）。
const TIMELINE_MSG_CHARS: usize = 20000;

// ============================================================
// 内部模型：镜像 OpenCode 三种 JSON 文件
// ============================================================

/// session/<projectID>/<session_id>.json 的会话元信息
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)]
struct OcSession {
    pub id: Option<String>,
    /// 项目工作目录（作 project_path）
    pub directory: Option<String>,
    pub title: Option<String>,
    pub time: Option<OcTime>,
}

/// time 子对象：created/updated 均为 epoch 毫秒
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)]
struct OcTime {
    pub created: Option<i64>,
    pub updated: Option<i64>,
}

/// message/<session_id>/<message_id>.json 的单条消息
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)]
struct OcMessage {
    pub id: Option<String>,
    #[serde(rename = "sessionID")]
    pub session_id: Option<String>,
    /// 角色：user / assistant
    pub role: Option<String>,
    pub time: Option<OcTime>,
    pub model: Option<OcModel>,
}

/// message.model 子对象（providerID/modelID）
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)]
struct OcModel {
    #[serde(rename = "providerID")]
    pub provider_id: Option<String>,
    #[serde(rename = "modelID")]
    pub model_id: Option<String>,
}

/// part/<message_id>/<part_id>.json 的正文分片
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)]
pub(crate) struct OcPart {
    pub id: Option<String>,
    #[serde(rename = "messageID")]
    pub message_id: Option<String>,
    /// 分片类型："text" 是正文；"tool" 是工具调用（含 tool 名 + state.input）
    #[serde(rename = "type")]
    pub part_type: Option<String>,
    pub text: Option<String>,
    /// 工具名（仅 type=="tool" 分片有），如 read/glob/todowrite
    pub tool: Option<String>,
    /// 工具调用状态子对象（仅 type=="tool" 分片有），含 input
    pub state: Option<OcToolState>,
}

/// tool 分片的 state 子对象：只关心 input（参数对象，用于生成简洁描述）。
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)]
pub(crate) struct OcToolState {
    pub status: Option<String>,
    pub input: Option<serde_json::Value>,
}

// ============================================================
// OpenCodeProvider 主体
// ============================================================

pub struct OpenCodeProvider;

impl SessionProvider for OpenCodeProvider {
    fn id(&self) -> &'static str {
        "opencode"
    }

    fn display_name(&self) -> &'static str {
        "OpenCode"
    }

    /// storage 根目录存在 或 opencode 二进制可查到 → 视为可用
    fn is_available(&self) -> bool {
        storage_root().map(|r| r.exists()).unwrap_or(false) || opencode_binary_exists()
    }

    /// 监听 storage 根（递归）——session/message/part 三层都在其下
    fn watch_roots(&self) -> Vec<WatchRoot> {
        match storage_root() {
            Some(root) => vec![WatchRoot {
                path: root,
                recursive: true,
            }],
            None => Vec::new(),
        }
    }

    /// 探测路径：storage 根（用于定期轮询）
    fn refresh_probe_paths(&self) -> Vec<PathBuf> {
        match storage_root() {
            Some(root) => vec![root],
            None => Vec::new(),
        }
    }

    /// 全量扫描：glob `storage/session/*/*.json`，逐个解析成 Session
    fn scan_all(&self) -> Vec<Session> {
        let root = match storage_root() {
            Some(r) => r,
            None => return Vec::new(),
        };
        let mut sessions = Vec::new();
        // session/<projectID>/<session_id>.json：两层目录遍历
        let session_dir = root.join("session");
        if let Ok(projects) = fs::read_dir(&session_dir) {
            for proj in projects.flatten() {
                let proj_path = proj.path();
                if !proj_path.is_dir() {
                    continue;
                }
                if let Ok(files) = fs::read_dir(&proj_path) {
                    for f in files.flatten() {
                        let p = f.path();
                        if p.extension().and_then(|e| e.to_str()) == Some("json") {
                            if let Some(s) = scan_opencode_session(&p, &root) {
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
    /// - 路径在 storage/session|message|part 下 → 增量扫描
    /// - 其他 → 忽略
    fn classify_event(&self, path: &Path) -> EventKind {
        let root = match storage_root() {
            Some(r) => r,
            None => return EventKind::Ignore,
        };
        for sub in ["session", "message", "part"] {
            if path.starts_with(root.join(sub)) {
                return EventKind::Incremental;
            }
        }
        EventKind::Ignore
    }

    /// 增量扫描：从事件路径解析出 session_id，定位会话元文件重新解析。
    /// - session/<pid>/<sid>.json → 直接解析该文件。
    /// - message/<sid>/*.json、part/<mid>/*.json → 由路径解析出 sid，再定位会话元文件。
    fn scan_one(&self, path: &Path) -> Option<Session> {
        let root = storage_root()?;
        let sid = session_id_from_path(path, &root)?;
        let meta = find_session_meta_file(&root, &sid)?;
        scan_opencode_session(&meta, &root)
    }

    /// 生成 OpenCode 会话恢复命令
    fn resume_command(&self, _project_path: &str, session_id: &str) -> String {
        format!("opencode --session {}", session_id)
    }

    /// argv 版恢复命令：`["opencode", "--session", <session_id>]`。
    /// session_id 作独立 argv 元素，web 侧直传 CommandBuilder、不经 shell → 无注入面。
    fn resume_argv(&self, _project_path: &str, session_id: &str) -> Vec<String> {
        vec![
            "opencode".to_string(),
            "--session".to_string(),
            session_id.to_string(),
        ]
    }

    /// 读取指定会话的时间轴消息列表
    fn read_timeline(&self, session_id: &str) -> Vec<TimelineMessage> {
        let root = match storage_root() {
            Some(r) => r,
            None => return Vec::new(),
        };
        read_opencode_timeline(&root, session_id)
    }
}

// ============================================================
// storage 根定位（可移植探测；不硬编码个人路径）
// ============================================================

/// 按序探测第一个存在的 storage 根：
/// 1. `$XDG_DATA_HOME/opencode/storage`
/// 2. `~/.local/share/opencode/storage`（OpenCode 在 Windows 上也用此路径）
/// 3. `dirs::data_dir()/opencode/storage`
/// 全部不存在时，返回候选 2（作为写入/监听的默认根，即便暂不存在）。
fn storage_root() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. XDG_DATA_HOME（非空才算）
    if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        if !xdg.trim().is_empty() {
            candidates.push(PathBuf::from(xdg.trim()).join("opencode").join("storage"));
        }
    }

    // 2. ~/.local/share/opencode/storage —— OpenCode 在各平台统一用此路径
    let home_default = dirs::home_dir().map(|h| {
        h.join(".local")
            .join("share")
            .join("opencode")
            .join("storage")
    });
    if let Some(ref p) = home_default {
        candidates.push(p.clone());
    }

    // 3. dirs::data_dir()/opencode/storage（平台标准数据目录兜底）
    if let Some(d) = dirs::data_dir() {
        candidates.push(d.join("opencode").join("storage"));
    }

    // 优先返回第一个真实存在的候选
    if let Some(existing) = candidates.iter().find(|p| p.exists()) {
        return Some(existing.clone());
    }
    // 都不存在 → 用 ~/.local/share 作默认根（供 watch/probe），home 取不到则退首个候选
    home_default.or_else(|| candidates.into_iter().next())
}

/// 判断系统 PATH 中是否存在 opencode 二进制（is_available 的另一半判据）。
/// 复用统一的 PATH 探测（Windows 补 .exe/.cmd/.bat；不启子进程），避免多处重复实现。
fn opencode_binary_exists() -> bool {
    crate::commands::cli::bin_in_path("opencode")
}

// ============================================================
// 单个 session 解析
// ============================================================

/// 解析单个 OpenCode 会话：读会话元文件 + 该会话所有 message/part，产出 Session。
/// `root` 为 storage 根（用于定位 message/part 子目录）。供 scan_all/scan_one 和测试使用。
pub fn scan_opencode_session(meta_path: &Path, root: &Path) -> Option<Session> {
    let meta: OcSession = read_json(meta_path)?;
    let session_id = meta.id?;
    if session_id.is_empty() {
        return None;
    }

    let directory = meta.directory.unwrap_or_default();
    let project_name = project_name_from_dir(&directory);

    // 时间：epoch 毫秒 → DateTime<Utc>
    let time = meta.time.unwrap_or(OcTime {
        created: None,
        updated: None,
    });
    let created_at = time
        .created
        .and_then(epoch_ms_to_utc)
        .unwrap_or_else(Utc::now);
    let updated_at = time
        .updated
        .and_then(epoch_ms_to_utc)
        .unwrap_or(created_at);

    // 读该会话所有消息（按 time.created 升序），拼各自 part 正文
    let msgs = load_messages_sorted(root, &session_id);
    let message_count = msgs.len() as u32;

    // 提取用户消息正文（role=="user"）
    let mut user_messages: Vec<String> = Vec::new();
    // by_model：JSON 无 token 计数 → 按 message.model.modelID 记 0（total_tokens 恒 0）
    let mut by_model: HashMap<String, u64> = HashMap::new();
    for m in &msgs {
        if let Some(model) = m.model.as_ref().and_then(|md| md.model_id.clone()) {
            if !model.is_empty() {
                by_model.entry(model).or_insert(0);
            }
        }
        if m.role.as_deref() == Some("user") {
            let body = join_message_text(root, m.id.as_deref().unwrap_or(""));
            if !body.is_empty() {
                user_messages.push(body);
            }
        }
    }

    Some(Session {
        session_id,
        provider: "opencode".to_string(),
        project_path: directory,
        project_name,
        first_prompt: user_messages.first().cloned().unwrap_or_default(),
        last_prompt: user_messages.last().cloned().unwrap_or_default(),
        created_at,
        updated_at,
        message_count,
        user_messages,
        total_tokens: 0, // token 仅存 SQLite，本次不读 → 恒 0
        by_model,
    })
}

/// 读取指定会话的时间轴消息列表：所有 message + part，按时间升序。
/// 每条消息里：先产出拼接后的文本气泡（若有），再按 part 顺序产出工具调用 chip。
fn read_opencode_timeline(root: &Path, session_id: &str) -> Vec<TimelineMessage> {
    let msgs = load_messages_sorted(root, session_id);
    let mut out = Vec::new();
    for m in &msgs {
        let role = m.role.clone().unwrap_or_else(|| "user".to_string());
        let ts = format_epoch_ms(m.time.as_ref().and_then(|t| t.created));
        let body = join_message_text(root, m.id.as_deref().unwrap_or(""));
        if !body.is_empty() {
            out.push(TimelineMessage {
                role: role.clone(),
                content: truncate(&body, TIMELINE_MSG_CHARS),
                timestamp: ts.clone(),
            });
        }
        // 工具调用条目：按 part 文件名顺序（与文本拼接同序）产出 role="tool"
        for summary in collect_message_tool_summaries(root, m.id.as_deref().unwrap_or("")) {
            out.push(TimelineMessage {
                role: "tool".to_string(),
                content: summary,
                timestamp: ts.clone(),
            });
        }
    }
    // 限制最大消息数，防止超大 IPC 响应。保留最近 500 条（同 codex）。
    if out.len() > 500 {
        out.drain(0..out.len() - 500);
    }
    out
}

/// 纯函数：从一个 opencode `type=="tool"` 分片生成时间线里的「工具调用」简洁描述。
/// 分片形如 `{"type":"tool","tool":"read","state":{"input":{"filePath":"..."}}}`。
/// 返回 `None` 表示无有效工具名。格式约定（opencode 参数名与其它 provider 略有差异）：
/// - read/edit/write → `"工具名: <filePath>"`（注意驼峰 filePath）
/// - bash → `"bash: <命令前若干字>"`（取 state.input.command）
/// - glob/grep → `"工具名: <pattern>"`
/// - webfetch → `"工具名: <url>"`
/// - 其它/取不到参数 → 仅工具名。
pub(crate) fn opencode_tool_summary(part: &OcPart) -> Option<String> {
    let name = part.tool.as_deref().unwrap_or("");
    if name.is_empty() {
        return None;
    }
    let input = part.state.as_ref().and_then(|s| s.input.as_ref());
    let str_arg = |key: &str| -> Option<String> {
        input
            .and_then(|i| i.get(key))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
    };
    // opencode 文件参数为 filePath（驼峰），命令为 command，检索为 pattern，抓取为 url
    let target = str_arg("filePath")
        .or_else(|| str_arg("file_path"))
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

/// 读取某条消息的全部工具调用分片，按 part 文件名升序返回简洁描述列表。
/// 与 join_message_text 同序（同一排序规则），保证工具 chip 与文本相对位置稳定。
fn collect_message_tool_summaries(root: &Path, message_id: &str) -> Vec<String> {
    if message_id.is_empty() {
        return Vec::new();
    }
    let dir = root.join("part").join(message_id);
    let mut entries: Vec<PathBuf> = Vec::new();
    if let Ok(files) = fs::read_dir(&dir) {
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) == Some("json") {
                entries.push(p);
            }
        }
    }
    entries.sort();
    let mut out = Vec::new();
    for p in entries {
        if let Some(part) = read_json::<OcPart>(&p) {
            if part.part_type.as_deref() == Some("tool") {
                if let Some(s) = opencode_tool_summary(&part) {
                    out.push(s);
                }
            }
        }
    }
    out
}

// ============================================================
// 消息 / 正文加载
// ============================================================

/// 读取 `storage/message/<session_id>/*.json` 全部消息，按 time.created 升序返回。
fn load_messages_sorted(root: &Path, session_id: &str) -> Vec<OcMessage> {
    let dir = root.join("message").join(session_id);
    let mut msgs: Vec<OcMessage> = Vec::new();
    if let Ok(files) = fs::read_dir(&dir) {
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Some(m) = read_json::<OcMessage>(&p) {
                    msgs.push(m);
                }
            }
        }
    }
    // 按 time.created 升序（缺失时间的排最前，退而用 0）
    msgs.sort_by_key(|m| m.time.as_ref().and_then(|t| t.created).unwrap_or(0));
    msgs
}

/// 拼接某条消息的全部正文：读 `storage/part/<message_id>/*.json`，
/// 取所有 `type=="text"` 的 `text` 拼接（按 part 文件名升序，稳定顺序）。
fn join_message_text(root: &Path, message_id: &str) -> String {
    if message_id.is_empty() {
        return String::new();
    }
    let dir = root.join("part").join(message_id);
    let mut entries: Vec<PathBuf> = Vec::new();
    if let Ok(files) = fs::read_dir(&dir) {
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) == Some("json") {
                entries.push(p);
            }
        }
    }
    // 按文件名排序，保证多 part 拼接顺序稳定
    entries.sort();
    let mut parts: Vec<String> = Vec::new();
    for p in entries {
        if let Some(part) = read_json::<OcPart>(&p) {
            if part.part_type.as_deref() == Some("text") {
                if let Some(t) = part.text {
                    if !t.is_empty() {
                        parts.push(t);
                    }
                }
            }
        }
    }
    parts.join("")
}

// ============================================================
// 路径 → session_id / 会话元文件定位
// ============================================================

/// 从 storage 内的事件路径解析出 session_id：
/// - session/<pid>/<sid>.json → 文件名去扩展名 = sid
/// - message/<sid>/<mid>.json → 上级目录名 = sid
/// - part/<mid>/<pid>.json    → 无法直接得 sid，返回 None（交由上层 FullRescan 语义）
fn session_id_from_path(path: &Path, root: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let mut comps = rel.components();
    let first = comps.next()?.as_os_str().to_str()?;
    match first {
        "session" => {
            // session/<pid>/<sid>.json → 文件名去扩展名
            path.file_stem().and_then(|s| s.to_str()).map(String::from)
        }
        "message" => {
            // message/<sid>/<mid>.json → 第二段目录名即 sid
            comps.next().map(|c| c.as_os_str().to_string_lossy().to_string())
        }
        // part/<mid>/... 无法从路径反查 sid（part 只知 messageID）→ 交回 None
        _ => None,
    }
}

/// 在 `storage/session/*/` 下按 `<session_id>.json` 定位会话元文件。
fn find_session_meta_file(root: &Path, session_id: &str) -> Option<PathBuf> {
    let session_dir = root.join("session");
    let projects = fs::read_dir(&session_dir).ok()?;
    for proj in projects.flatten() {
        let proj_path = proj.path();
        if !proj_path.is_dir() {
            continue;
        }
        let candidate = proj_path.join(format!("{}.json", session_id));
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

// ============================================================
// 纯函数辅助（可 standalone 单测）
// ============================================================

/// epoch 毫秒 → DateTime<Utc>。非法/越界 → None。
fn epoch_ms_to_utc(ms: i64) -> Option<DateTime<Utc>> {
    match Utc.timestamp_millis_opt(ms) {
        chrono::LocalResult::Single(dt) => Some(dt),
        _ => None,
    }
}

/// 从工作目录取项目名（最后一段目录名）。同时兼容 Windows(`\`) 与 Unix(`/`) 分隔符。
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

/// epoch 毫秒 → HH:MM:SS 时间串（用于时间轴；同 codex format_timestamp 思路）。
/// 无时间戳或非法 → 空串。
fn format_epoch_ms(ms: Option<i64>) -> String {
    match ms.and_then(epoch_ms_to_utc) {
        Some(dt) => dt.format("%H:%M:%S").to_string(),
        None => String::new(),
    }
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
// 单元测试（TDD，仿 codex.rs 的 #[cfg(test)]）
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 在临时目录里造一套假 storage：一个 session + 两条 message(user/assistant) + 各自 text part。
    /// 返回 (tempdir, storage_root, session_id)。
    fn make_fixture() -> (tempfile::TempDir, PathBuf, String) {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("storage");
        let sid = "ses_test123".to_string();
        let pid = "proj_abc";
        let msg_user = "msg_user1";
        let msg_asst = "msg_asst1";

        // session/<pid>/<sid>.json —— directory 用 Windows 风格分隔符验证 project_name 提取
        let session_dir = root.join("session").join(pid);
        fs::create_dir_all(&session_dir).unwrap();
        let session_json = serde_json::json!({
            "id": sid,
            "projectID": pid,
            "directory": "D:\\workspace\\copynavicat",
            "title": "当前项目分析",
            "time": { "created": 1769412016515i64, "updated": 1769424456380i64 }
        });
        fs::write(
            session_dir.join(format!("{}.json", sid)),
            serde_json::to_string(&session_json).unwrap(),
        )
        .unwrap();

        // message/<sid>/<mid>.json —— user 在前（created 更早），assistant 在后
        let msg_dir = root.join("message").join(&sid);
        fs::create_dir_all(&msg_dir).unwrap();
        let user_msg = serde_json::json!({
            "id": msg_user, "sessionID": sid, "role": "user",
            "time": { "created": 1769412016537i64 },
            "model": { "providerID": "github-copilot", "modelID": "claude-opus-4.5" }
        });
        let asst_msg = serde_json::json!({
            "id": msg_asst, "sessionID": sid, "role": "assistant",
            "time": { "created": 1769412020000i64 },
            "model": { "providerID": "github-copilot", "modelID": "claude-opus-4.5" }
        });
        fs::write(
            msg_dir.join(format!("{}.json", msg_user)),
            serde_json::to_string(&user_msg).unwrap(),
        )
        .unwrap();
        fs::write(
            msg_dir.join(format!("{}.json", msg_asst)),
            serde_json::to_string(&asst_msg).unwrap(),
        )
        .unwrap();

        // part/<mid>/<pid>.json —— 各一条 text part
        let part_user_dir = root.join("part").join(msg_user);
        fs::create_dir_all(&part_user_dir).unwrap();
        let part_user = serde_json::json!({
            "id": "prt_u1", "sessionID": sid, "messageID": msg_user,
            "type": "text", "text": "分析当前项目"
        });
        fs::write(
            part_user_dir.join("prt_u1.json"),
            serde_json::to_string(&part_user).unwrap(),
        )
        .unwrap();

        let part_asst_dir = root.join("part").join(msg_asst);
        fs::create_dir_all(&part_asst_dir).unwrap();
        let part_asst = serde_json::json!({
            "id": "prt_a1", "sessionID": sid, "messageID": msg_asst,
            "type": "text", "text": "好的，正在分析..."
        });
        fs::write(
            part_asst_dir.join("prt_a1.json"),
            serde_json::to_string(&part_asst).unwrap(),
        )
        .unwrap();

        (tmp, root, sid)
    }

    /// TDD：从假 storage 扫描单会话，断言字段映射正确。
    #[test]
    fn scan_one_parses_opencode_fixture() {
        let (_tmp, root, sid) = make_fixture();
        let meta = find_session_meta_file(&root, &sid).expect("应能定位会话元文件");
        let session = scan_opencode_session(&meta, &root).expect("应成功解析为 Session");

        assert_eq!(session.session_id, "ses_test123");
        assert_eq!(session.provider, "opencode");
        // project_path = directory（原样，Windows 分隔符）
        assert_eq!(session.project_path, "D:\\workspace\\copynavicat");
        // project_name = 最后一段目录名
        assert_eq!(session.project_name, "copynavicat");
        // 消息计数：user + assistant = 2
        assert_eq!(session.message_count, 2);
        // 用户消息仅一条
        assert_eq!(session.user_messages.len(), 1);
        assert_eq!(session.first_prompt, "分析当前项目");
        assert_eq!(session.last_prompt, "分析当前项目");
        // token 恒 0；by_model 按 modelID 记 0
        assert_eq!(session.total_tokens, 0);
        assert_eq!(session.by_model.get("claude-opus-4.5"), Some(&0u64));
        // created_at 从 epoch ms 转换正确
        assert_eq!(
            session.created_at,
            epoch_ms_to_utc(1769412016515).unwrap()
        );
        assert_eq!(
            session.updated_at,
            epoch_ms_to_utc(1769424456380).unwrap()
        );
    }

    /// 时间轴：user + assistant 两条，按时间升序，正文来自 text part。
    #[test]
    fn read_timeline_from_fixture() {
        let (_tmp, root, sid) = make_fixture();
        let msgs = read_opencode_timeline(&root, &sid);
        assert_eq!(msgs.len(), 2, "应有 2 条时间轴消息");
        assert_eq!(msgs[0].role, "user");
        assert_eq!(msgs[0].content, "分析当前项目");
        assert_eq!(msgs[1].role, "assistant");
        assert_eq!(msgs[1].content, "好的，正在分析...");
    }

    /// opencode_tool_summary：read 取 filePath（驼峰），bash 取 command，
    /// glob 取 pattern，未知/无参数退回工具名。
    #[test]
    fn tool_summary_picks_target_arg() {
        let mk = |v: serde_json::Value| serde_json::from_value::<OcPart>(v).unwrap();
        let read = mk(serde_json::json!({"type":"tool","tool":"read","state":{"input":{"filePath":"/a.rs"}}}));
        assert_eq!(opencode_tool_summary(&read).unwrap(), "read: /a.rs");
        let bash = mk(serde_json::json!({"type":"tool","tool":"bash","state":{"input":{"command":"ls\n-la"}}}));
        assert_eq!(opencode_tool_summary(&bash).unwrap(), "bash: ls -la");
        let glob = mk(serde_json::json!({"type":"tool","tool":"glob","state":{"input":{"pattern":"**/*.rs"}}}));
        assert_eq!(opencode_tool_summary(&glob).unwrap(), "glob: **/*.rs");
        let todo = mk(serde_json::json!({"type":"tool","tool":"todowrite","state":{"input":{"todos":[]}}}));
        assert_eq!(opencode_tool_summary(&todo).unwrap(), "todowrite");
        let noname = mk(serde_json::json!({"type":"tool","state":{"input":{"filePath":"/a"}}}));
        assert!(opencode_tool_summary(&noname).is_none());
    }

    /// 时间线：assistant 消息里的 tool 分片 → 文本气泡后紧跟 role="tool" 条目。
    #[test]
    fn timeline_includes_opencode_tool_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let sid = "ses_tool";
        // 一条 assistant 消息
        let mid = "msg_a";
        let msg_dir = root.join("message").join(sid);
        fs::create_dir_all(&msg_dir).unwrap();
        fs::write(
            msg_dir.join(format!("{}.json", mid)),
            serde_json::to_string(&serde_json::json!({
                "id": mid, "sessionID": sid, "role": "assistant",
                "time": {"created": 1769412016515_i64}
            }))
            .unwrap(),
        )
        .unwrap();
        // part：先 text 后 tool（文件名保证 text 在前）
        let part_dir = root.join("part").join(mid);
        fs::create_dir_all(&part_dir).unwrap();
        fs::write(
            part_dir.join("prt_1_text.json"),
            serde_json::to_string(&serde_json::json!({"type":"text","text":"我来读"})).unwrap(),
        )
        .unwrap();
        fs::write(
            part_dir.join("prt_2_tool.json"),
            serde_json::to_string(&serde_json::json!({
                "type":"tool","tool":"read","state":{"input":{"filePath":"/x.rs"}}
            }))
            .unwrap(),
        )
        .unwrap();
        let msgs = read_opencode_timeline(&root, sid);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role, "assistant");
        assert_eq!(msgs[0].content, "我来读");
        assert_eq!(msgs[1].role, "tool");
        assert_eq!(msgs[1].content, "read: /x.rs");
    }

    /// 多个 text part 应按文件名升序拼接。
    #[test]
    fn join_message_text_concatenates_parts() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let mid = "msg_multi";
        let dir = root.join("part").join(mid);
        fs::create_dir_all(&dir).unwrap();
        // 故意乱序写入，验证按文件名排序拼接
        fs::write(
            dir.join("prt_2.json"),
            serde_json::to_string(&serde_json::json!({"type":"text","text":"世界"})).unwrap(),
        )
        .unwrap();
        fs::write(
            dir.join("prt_1.json"),
            serde_json::to_string(&serde_json::json!({"type":"text","text":"你好"})).unwrap(),
        )
        .unwrap();
        // 非 text 分片应被跳过
        fs::write(
            dir.join("prt_3.json"),
            serde_json::to_string(&serde_json::json!({"type":"tool","text":"忽略我"})).unwrap(),
        )
        .unwrap();
        assert_eq!(join_message_text(&root, mid), "你好世界");
    }

    /// resume_argv：session_id 保持独立 argv 元素，含元字符也不被拆。
    #[test]
    fn resume_argv_keeps_session_id_as_single_element() {
        let provider = OpenCodeProvider;
        let argv = provider.resume_argv("/home/user/project", "x; rm -rf /");
        assert_eq!(argv, vec!["opencode", "--session", "x; rm -rf /"]);
        assert_eq!(argv[2], "x; rm -rf /");
    }

    /// resume_command 字符串格式。
    #[test]
    fn resume_command_format() {
        let provider = OpenCodeProvider;
        assert_eq!(
            provider.resume_command("/proj", "ses_abc"),
            "opencode --session ses_abc"
        );
    }

    /// epoch 毫秒 → DateTime 转换（纯函数）。
    #[test]
    fn epoch_ms_to_utc_converts() {
        let dt = epoch_ms_to_utc(1769412016515).unwrap();
        assert_eq!(dt.timestamp_millis(), 1769412016515);
    }

    /// 路径 → 项目名（Windows/Unix 分隔符都要处理）。
    #[test]
    fn project_name_handles_both_separators() {
        assert_eq!(project_name_from_dir("D:\\workspace\\copynavicat"), "copynavicat");
        assert_eq!(project_name_from_dir("/home/user/myproject"), "myproject");
        assert_eq!(project_name_from_dir("/home/user/trailing/"), "trailing");
        assert_eq!(project_name_from_dir(""), "");
    }

    /// classify_event：storage/session|message|part 内 → Incremental；无关路径 → Ignore。
    /// 用 XDG_DATA_HOME 指向临时目录以稳定 storage 根（避免依赖真实机器路径）。
    #[test]
    fn classify_event_inside_storage_is_incremental() {
        let tmp = tempfile::tempdir().unwrap();
        // 让 storage_root() 命中临时目录
        std::env::set_var("XDG_DATA_HOME", tmp.path());
        let root = tmp.path().join("opencode").join("storage");
        fs::create_dir_all(root.join("session")).unwrap();

        let provider = OpenCodeProvider;
        let session_file = root.join("session").join("pid").join("sid.json");
        assert_eq!(
            provider.classify_event(&session_file),
            EventKind::Incremental
        );
        let msg_file = root.join("message").join("sid").join("mid.json");
        assert_eq!(provider.classify_event(&msg_file), EventKind::Incremental);
        let part_file = root.join("part").join("mid").join("pid.json");
        assert_eq!(provider.classify_event(&part_file), EventKind::Incremental);

        // 无关路径 → Ignore
        assert_eq!(
            provider.classify_event(Path::new("/some/other/path.txt")),
            EventKind::Ignore
        );
        std::env::remove_var("XDG_DATA_HOME");
    }

    /// session_id_from_path：从 session/message 路径解析 sid；part 路径解析不出 → None。
    #[test]
    fn session_id_from_path_resolves() {
        let root = Path::new("/root/storage");
        let sess = root.join("session").join("pid").join("ses_x.json");
        assert_eq!(
            session_id_from_path(&sess, root),
            Some("ses_x".to_string())
        );
        let msg = root.join("message").join("ses_y").join("msg_1.json");
        assert_eq!(
            session_id_from_path(&msg, root),
            Some("ses_y".to_string())
        );
        // part 路径无法反查 sid
        let part = root.join("part").join("msg_1").join("prt_1.json");
        assert_eq!(session_id_from_path(&part, root), None);
    }
}
