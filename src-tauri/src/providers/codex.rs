// providers/codex.rs — Codex CLI provider，从 retalk 移植
// 实现 SessionProvider trait，支持 JSONL 格式的 Codex 会话解析：
// - session_meta → 会话 id + cwd
// - event_msg(user_message) → 用户消息文本
// - event_msg(token_count) → token 累计统计（取最后一条为总量）

use super::{EventKind, SessionProvider, WatchRoot};
use crate::models::{Session, TimelineMessage};
use crate::paths::AppPaths;
use chrono::{DateTime, Utc};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

// ============================================================
// 内部模型：用于反序列化 Codex JSONL 行
// ============================================================

/// Codex JSONL 单行记录（type 判别器 + payload）
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)]
struct CodexEntry {
    #[serde(rename = "type")]
    pub entry_type: Option<String>,
    pub timestamp: Option<String>,
    pub payload: Option<serde_json::Value>,
}

// ============================================================
// CodexProvider 主体
// ============================================================

pub struct CodexProvider;

impl SessionProvider for CodexProvider {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn display_name(&self) -> &'static str {
        "Codex CLI"
    }

    /// ~/.codex/sessions 目录存在时视为可用
    fn is_available(&self) -> bool {
        AppPaths::detect().codex_dir().join("sessions").exists()
    }

    /// 监听 ~/.codex/sessions（递归）
    fn watch_roots(&self) -> Vec<WatchRoot> {
        let sessions = AppPaths::detect().codex_dir().join("sessions");
        vec![WatchRoot {
            path: sessions,
            recursive: true,
        }]
    }

    /// 探测路径：~/.codex/sessions（用于定期轮询）
    fn refresh_probe_paths(&self) -> Vec<PathBuf> {
        let sessions = AppPaths::detect().codex_dir().join("sessions");
        vec![sessions]
    }

    /// 全量扫描：递归遍历 ~/.codex/sessions/，解析所有 .jsonl 文件
    fn scan_all(&self) -> Vec<Session> {
        let sessions_dir = AppPaths::detect().codex_dir().join("sessions");
        let mut sessions = Vec::new();
        visit_dir(&sessions_dir, &mut sessions);
        // 按更新时间降序排列（最新在前）
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        sessions
    }

    /// 事件分类：
    /// - 路径在 ~/.codex/sessions 下且以 .jsonl 结尾 → 增量扫描
    /// - 其他 → 忽略
    fn classify_event(&self, path: &Path) -> EventKind {
        let sessions = AppPaths::detect().codex_dir().join("sessions");
        if path.starts_with(&sessions)
            && path.extension().and_then(|e| e.to_str()) == Some("jsonl")
        {
            return EventKind::Incremental;
        }
        EventKind::Ignore
    }

    /// 增量扫描：解析单个 Codex session .jsonl 文件
    fn scan_one(&self, path: &Path) -> Option<Session> {
        scan_codex_session(path)
    }

    /// 生成 Codex 会话恢复命令（来自 retalk terminal.rs codex arm）
    fn resume_command(&self, _project_path: &str, session_id: &str) -> String {
        format!("codex resume {}", session_id)
    }

    /// 读取指定会话的时间轴消息列表
    fn read_timeline(&self, session_id: &str) -> Vec<TimelineMessage> {
        read_codex_timeline(session_id)
    }
}

// ============================================================
// 递归目录遍历（来自 retalk providers/codex.rs::visit_dir）
// ============================================================

/// 递归遍历目录，将所有 .jsonl 文件解析后加入会话列表
fn visit_dir(dir: &Path, sessions: &mut Vec<Session>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            visit_dir(&path, sessions);
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            if let Some(session) = scan_codex_session(&path) {
                sessions.push(session);
            }
        }
    }
}

// ============================================================
// 单个 session 文件解析（来自 retalk providers/codex.rs::scan_single_codex_session）
// ============================================================

/// 解析单个 Codex session JSONL 文件，供 scan_one 和测试使用
pub fn scan_codex_session(path: &Path) -> Option<Session> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut session_id = String::new();
    let mut cwd = String::new();
    let mut user_messages: Vec<String> = Vec::new();
    let mut first_timestamp: Option<DateTime<Utc>> = None;
    let mut last_timestamp: Option<DateTime<Utc>> = None;
    let mut total_tokens: u64 = 0;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        let entry: CodexEntry = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };

        // 解析时间戳：记录首条和末条时间
        if let Some(ts_str) = &entry.timestamp {
            if let Ok(ts) = ts_str.parse::<DateTime<Utc>>() {
                if first_timestamp.is_none() {
                    first_timestamp = Some(ts);
                }
                last_timestamp = Some(ts);
            }
        }

        match entry.entry_type.as_deref() {
            Some("session_meta") => {
                // session_meta → 提取会话 id 和项目工作目录
                if let Some(payload) = &entry.payload {
                    if let Some(id) = payload.get("id").and_then(|v| v.as_str()) {
                        session_id = id.to_string();
                    }
                    if let Some(c) = payload.get("cwd").and_then(|v| v.as_str()) {
                        cwd = c.to_string();
                    }
                }
            }
            Some("event_msg") => {
                if let Some(payload) = &entry.payload {
                    let ptype = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    match ptype {
                        "user_message" => {
                            // 提取用户消息文本
                            if let Some(msg) = payload.get("message").and_then(|v| v.as_str()) {
                                if !msg.is_empty() {
                                    user_messages.push(msg.to_string());
                                }
                            }
                        }
                        "token_count" => {
                            // total_token_usage 是累计值，取最后一条即为总量
                            if let Some(usage) =
                                payload.get("info").and_then(|i| i.get("total_token_usage"))
                            {
                                let input = usage
                                    .get("input_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                                let output = usage
                                    .get("output_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                                total_tokens = input + output;
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    // 会话必须同时有 session_id 和至少一条用户消息才算有效
    if user_messages.is_empty() || session_id.is_empty() {
        return None;
    }

    let project_name = Path::new(&cwd)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    Some(Session {
        session_id,
        provider: "codex".to_string(),
        project_path: cwd,
        project_name,
        first_prompt: user_messages.first().cloned().unwrap_or_default(),
        last_prompt: user_messages.last().cloned().unwrap_or_default(),
        created_at: first_timestamp.unwrap_or_else(Utc::now),
        updated_at: last_timestamp.unwrap_or_else(Utc::now),
        message_count: user_messages.len() as u32,
        user_messages,
        total_tokens,
    })
}

// ============================================================
// 时间轴解析（来自 retalk timeline.rs::read_codex_timeline）
// ============================================================

/// 读取指定会话的时间轴消息列表（内部通过 session_id 递归定位文件）
fn read_codex_timeline(session_id: &str) -> Vec<TimelineMessage> {
    let sessions_dir = AppPaths::detect().codex_dir().join("sessions");
    let path = match find_session_file_recursive(&sessions_dir, session_id) {
        Some(p) => p,
        None => return Vec::new(),
    };
    read_codex_timeline_from_path(&path)
}

/// 从给定路径读取 Codex 时间轴（方便测试注入 fixture）
pub fn read_codex_timeline_from_path(path: &Path) -> Vec<TimelineMessage> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let reader = BufReader::new(file);
    let mut messages = Vec::new();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        let raw: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let entry_type = raw.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let timestamp = raw
            .get("timestamp")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let payload = raw.get("payload");

        if entry_type == "event_msg" {
            if let Some(p) = payload {
                let ptype = p.get("type").and_then(|v| v.as_str()).unwrap_or("");
                match ptype {
                    "user_message" => {
                        let text = p.get("message").and_then(|v| v.as_str()).unwrap_or("");
                        if !text.is_empty() {
                            messages.push(TimelineMessage {
                                role: "user".to_string(),
                                content: truncate(text, 500),
                                timestamp: format_timestamp(&timestamp),
                            });
                        }
                    }
                    "agent_message" => {
                        let text = p.get("message").and_then(|v| v.as_str()).unwrap_or("");
                        if !text.is_empty() {
                            messages.push(TimelineMessage {
                                role: "assistant".to_string(),
                                content: truncate(text, 500),
                                timestamp: format_timestamp(&timestamp),
                            });
                        }
                    }
                    _ => {} // token_count 等事件不加入时间轴
                }
            }
        }
    }

    // 限制最大消息数，防止超大 IPC 响应
    if messages.len() > 500 {
        messages.truncate(500);
    }
    messages
}

// ============================================================
// 内部辅助函数
// ============================================================

/// 递归查找包含 session_id 的 .jsonl 文件（来自 retalk timeline.rs）
fn find_session_file_recursive(dir: &Path, session_id: &str) -> Option<PathBuf> {
    if !dir.exists() {
        return None;
    }
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_session_file_recursive(&path, session_id) {
                return Some(found);
            }
        } else if path.to_string_lossy().contains(session_id)
            && path.extension().and_then(|e| e.to_str()) == Some("jsonl")
        {
            return Some(path);
        }
    }
    None
}

/// 截断字符串到指定字符数（超出部分用 "..." 替代）
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() > max {
        s.chars().take(max).collect::<String>() + "..."
    } else {
        s.to_string()
    }
}

/// 格式化时间戳为 HH:MM:SS（支持 ISO 8601 解析）
fn format_timestamp(ts: &str) -> String {
    if let Ok(dt) = ts.parse::<chrono::DateTime<chrono::Utc>>() {
        dt.format("%H:%M:%S").to_string()
    } else {
        ts.to_string()
    }
}

// ============================================================
// 单元测试
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------- TDD: 先写测试（RED），后实现（GREEN）--------

    /// TDD Step 1: 先写测试；Step 2: 实现 scan_codex_session 使其通过
    #[test]
    fn scan_one_parses_codex_fixture() {
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/codex/sample.jsonl");
        let session = scan_codex_session(&fixture).expect("fixture 应成功解析为 Session");

        // 验证 session_id 来自 session_meta 行
        assert_eq!(session.session_id, "codex-session-abc123");

        // 验证至少提取出一条用户消息
        assert!(
            !session.user_messages.is_empty(),
            "应至少有一条用户消息"
        );
        assert_eq!(session.message_count, 2, "fixture 包含 2 条用户消息");

        // 验证首条和末条用户消息内容
        assert_eq!(session.first_prompt, "请帮我写一个快速排序算法");
        assert_eq!(session.last_prompt, "能加上详细注释吗？");

        // 验证 token 统计：input(320) + output(180) = 500
        assert_eq!(session.total_tokens, 500);

        // 验证项目路径和名称
        assert_eq!(session.project_path, "/home/user/workspace/myproject");
        assert_eq!(session.project_name, "myproject");
    }

    /// 验证 resume_command 格式正确
    #[test]
    fn resume_command_format() {
        let provider = CodexProvider;
        assert_eq!(
            provider.resume_command("/home/user/project", "codex-session-abc123"),
            "codex resume codex-session-abc123"
        );
    }

    /// 验证 classify_event：~/.codex/sessions 下的 .jsonl → Incremental
    #[test]
    fn classify_event_sessions_jsonl_is_incremental() {
        let provider = CodexProvider;
        let codex = AppPaths::detect().codex_dir();
        let session_file = codex.join("sessions").join("some-id").join("session.jsonl");
        assert_eq!(provider.classify_event(&session_file), EventKind::Incremental);
    }

    /// 验证 classify_event：其他路径 → Ignore
    #[test]
    fn classify_event_other_path_is_ignore() {
        let provider = CodexProvider;
        assert_eq!(
            provider.classify_event(Path::new("/some/other/path.txt")),
            EventKind::Ignore
        );
    }

    /// 验证从 fixture 文件读取时间轴消息列表
    #[test]
    fn read_timeline_from_codex_fixture() {
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/codex/sample.jsonl");
        let messages = read_codex_timeline_from_path(&fixture);

        // fixture 含 2 条 user_message + 1 条 agent_message（token_count 行不计入）
        assert_eq!(messages.len(), 3, "应有 3 条时间轴消息（2 用户 + 1 助手）");
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[2].role, "user");
    }
}
