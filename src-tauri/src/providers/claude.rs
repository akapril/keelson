// providers/claude.rs — Claude Code provider，从 retalk 移植
// 实现 SessionProvider trait（Task 9），支持 scan_all / scan_one /
// classify_event / read_timeline / resume_command 等四大职责。

use super::{EventKind, SessionProvider, WatchRoot};
use crate::models::{Session, TimelineMessage};
use crate::paths::AppPaths;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

// ============================================================
// 内部模型：用于反序列化 history.jsonl 和 session .jsonl 行
// ============================================================

/// history.jsonl 中的单行记录
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)] // 字段通过 serde 反序列化，部分字段供未来功能使用
struct HistoryEntry {
    pub display: Option<String>,
    pub timestamp: Option<u64>,
    pub project: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
}

/// session JSONL 中的单行记录
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)] // 字段通过 serde 反序列化，部分字段供未来功能使用
struct SessionEntry {
    #[serde(rename = "type")]
    pub entry_type: Option<String>,
    pub message: Option<MessageContent>,
    pub timestamp: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct MessageContent {
    pub role: Option<String>,
    pub content: Option<serde_json::Value>,
}

// ============================================================
// ClaudeProvider 主体
// ============================================================

pub struct ClaudeProvider;

impl SessionProvider for ClaudeProvider {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn display_name(&self) -> &'static str {
        "Claude Code"
    }

    /// Claude Code 数据目录（~/.claude/projects）存在时视为可用
    fn is_available(&self) -> bool {
        AppPaths::detect().claude_dir().join("projects").exists()
    }

    /// 监听 ~/.claude/projects（递归）
    fn watch_roots(&self) -> Vec<WatchRoot> {
        let projects = AppPaths::detect().claude_dir().join("projects");
        vec![WatchRoot {
            path: projects,
            recursive: true,
        }]
    }

    /// 探测路径：~/.claude/history.jsonl（用于定期轮询）
    fn refresh_probe_paths(&self) -> Vec<PathBuf> {
        let history = AppPaths::detect().claude_dir().join("history.jsonl");
        vec![history]
    }

    /// 全量扫描：两阶段策略（history.jsonl 路径映射 + 逐 session 解析）
    fn scan_all(&self) -> Vec<Session> {
        let claude = AppPaths::detect().claude_dir();
        let history_path = claude.join("history.jsonl");
        let projects_dir = claude.join("projects");

        // 第一步：从 history.jsonl 建立 编码目录名 -> 原始路径 映射
        let history_map = parse_history(&history_path);

        // 第二步：遍历 projects/ 子目录下的所有 .jsonl 文件
        let mut sessions = Vec::new();
        if projects_dir.exists() {
            for project_entry in fs::read_dir(&projects_dir).into_iter().flatten() {
                let project_entry = match project_entry {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                let project_dir = project_entry.path();
                if !project_dir.is_dir() {
                    continue;
                }

                // 从 history_map 找到此目录对应的原始路径，找不到则 decode 兜底
                let dir_name = project_dir
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                let original_path = history_map
                    .get(&dir_name)
                    .cloned()
                    .unwrap_or_else(|| decode_project_dir(&dir_name));

                // 扫描此项目下的所有 session .jsonl 文件
                for file_entry in fs::read_dir(&project_dir).into_iter().flatten() {
                    let file_entry = match file_entry {
                        Ok(e) => e,
                        Err(_) => continue,
                    };
                    let file_path = file_entry.path();
                    if file_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                        continue;
                    }
                    let session_id = file_path
                        .file_stem()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();

                    if let Some(session) =
                        parse_session_file(&file_path, &session_id, &original_path)
                    {
                        sessions.push(session);
                    }
                }
            }
        }

        // 按 updated_at 降序排序（最新在前）
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        sessions
    }

    /// 事件分类：
    /// - 路径在 ~/.claude/projects 下且以 .jsonl 结尾 → 增量扫描
    /// - 路径是 history.jsonl → 全量重扫
    /// - 其他 → 忽略
    fn classify_event(&self, path: &Path) -> EventKind {
        let claude = AppPaths::detect().claude_dir();
        let history = claude.join("history.jsonl");
        let projects = claude.join("projects");

        if path == history {
            return EventKind::FullRescan;
        }
        if path.starts_with(&projects)
            && path.extension().and_then(|e| e.to_str()) == Some("jsonl")
        {
            // 排除子代理转录 <session>/subagents/agent-*.jsonl：属父会话内部的 Task 子代理，
            // 不建独立会话（否则文件监听会把每个子代理增量当成新会话灌进中枢）。
            if path.components().any(|c| c.as_os_str() == "subagents") {
                return EventKind::Ignore;
            }
            return EventKind::Incremental;
        }
        EventKind::Ignore
    }

    /// 增量扫描：解析单个 session .jsonl 文件
    fn scan_one(&self, path: &Path) -> Option<Session> {
        scan_one_impl(path)
    }

    /// 生成 Claude Code 会话恢复命令（来自 retalk terminal.rs claude arm）
    fn resume_command(&self, _project_path: &str, session_id: &str) -> String {
        format!("claude --resume {}", session_id)
    }

    /// 读取指定会话的时间轴消息列表
    fn read_timeline(&self, session_id: &str) -> Vec<TimelineMessage> {
        read_claude_timeline(session_id)
    }
}

// ============================================================
// scan_one 实现（供 scan_one trait 方法和测试调用）
// ============================================================

/// 实际的增量扫描逻辑，接受具体路径，方便测试注入 fixture
pub fn scan_one_impl(path: &Path) -> Option<Session> {
    // 防御：子代理转录（<session>/subagents/agent-*.jsonl）不作为独立会话解析。
    if path.components().any(|c| c.as_os_str() == "subagents") {
        return None;
    }
    let session_id = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let project_dir = path.parent()?;
    let dir_name = project_dir
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // 尝试从 history_map 获取原始路径，找不到则 decode 兜底
    let history_map = parse_history(&AppPaths::detect().claude_dir().join("history.jsonl"));
    let original_path = history_map
        .get(&dir_name)
        .cloned()
        .unwrap_or_else(|| decode_project_dir(&dir_name));

    parse_session_file(path, &session_id, &original_path)
}

// ============================================================
// history.jsonl 解析
// ============================================================

/// 解析 history.jsonl，建立 编码目录名 -> 原始路径 的映射（来自 retalk claude.rs）
fn parse_history(path: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return map,
    };
    let reader = BufReader::new(file);
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if let Ok(entry) = serde_json::from_str::<HistoryEntry>(&line) {
            if let Some(project) = entry.project {
                let encoded = encode_project_path(&project);
                map.insert(encoded, project);
            }
        }
    }
    map
}

// ============================================================
// session 文件解析（来自 retalk claude.rs::parse_session_file）
// ============================================================

/// 解析单个 session JSONL 文件
/// fallback_path 是从 history_map 或 decode 推断的路径，session 文件内的 cwd 优先
pub fn parse_session_file(
    path: &Path,
    session_id: &str,
    fallback_path: &str,
) -> Option<Session> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut user_messages = Vec::new();
    let mut first_timestamp: Option<DateTime<Utc>> = None;
    let mut last_timestamp: Option<DateTime<Utc>> = None;
    let mut message_count: u32 = 0;
    let mut total_tokens: u64 = 0;
    let mut by_model: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    let mut cwd_from_file: Option<String> = None;
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };

        // 先尝试作为通用 JSON 解析以提取 token 和 cwd 信息
        if let Ok(raw) = serde_json::from_str::<serde_json::Value>(&line) {
            // 检测 entrypoint：sdk-cli 是插件自动创建的会话，跳过（立即返回）
            if let Some(ep) = raw.get("entrypoint").and_then(|v| v.as_str()) {
                if ep == "sdk-cli" {
                    return None;
                }
            }

            // 提取 assistant 消息中的 usage 信息（按模型归因）
            if raw.get("type").and_then(|v| v.as_str()) == Some("assistant") {
                if let Some(usage) = raw.pointer("/message/usage") {
                    let g = |k: &str| usage.get(k).and_then(|v| v.as_u64()).unwrap_or(0);
                    // 同口径计入 input+output+cache（cache 量级常远大于 input，之前忽略导致成本系统性低估）
                    let tok = g("input_tokens")
                        + g("output_tokens")
                        + g("cache_creation_input_tokens")
                        + g("cache_read_input_tokens");
                    total_tokens += tok;
                    let model = raw
                        .pointer("/message/model")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .unwrap_or("(unknown)");
                    *by_model.entry(model.to_string()).or_insert(0) += tok;
                }
            }

            // 从 user 消息的 cwd 字段获取真实项目路径（最可靠）
            if cwd_from_file.is_none() {
                if let Some(cwd) = raw.get("cwd").and_then(|v| v.as_str()) {
                    if !cwd.is_empty() {
                        cwd_from_file = Some(cwd.to_string());
                    }
                }
            }
        }

        let entry: SessionEntry = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };

        if entry.entry_type.as_deref() != Some("user") {
            continue;
        }

        // 提取时间戳
        if let Some(ts_str) = &entry.timestamp {
            if let Ok(ts) = ts_str.parse::<DateTime<Utc>>() {
                if first_timestamp.is_none() {
                    first_timestamp = Some(ts);
                }
                last_timestamp = Some(ts);
            }
        }

        // 提取用户消息文本
        if let Some(msg) = &entry.message {
            if msg.role.as_deref() == Some("user") {
                if let Some(content) = &msg.content {
                    let text = extract_text_content(content);
                    if !text.is_empty() {
                        user_messages.push(text);
                        message_count += 1;
                    }
                }
            }
        }
    }

    if user_messages.is_empty() {
        return None;
    }

    // cwd 优先，fallback_path 兜底
    let project_path = cwd_from_file
        .as_deref()
        .unwrap_or(fallback_path)
        .to_string();

    let project_name = Path::new(&project_path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    Some(Session {
        session_id: session_id.to_string(),
        provider: "claude".to_string(),
        project_path,
        project_name,
        first_prompt: user_messages.first().cloned().unwrap_or_default(),
        last_prompt: user_messages.last().cloned().unwrap_or_default(),
        created_at: first_timestamp.unwrap_or_else(Utc::now),
        updated_at: last_timestamp.unwrap_or_else(Utc::now),
        message_count,
        user_messages,
        total_tokens,
        by_model,
    })
}

// ============================================================
// 时间轴解析（来自 retalk timeline.rs::read_claude_timeline）
// ============================================================

/// 读取指定会话的时间轴消息列表
fn read_claude_timeline(session_id: &str) -> Vec<TimelineMessage> {
    let projects_dir = AppPaths::detect().claude_dir().join("projects");

    // 在 projects/ 子目录下查找 {session_id}.jsonl
    let path = match find_session_file(&projects_dir, session_id) {
        Some(p) => p,
        None => return Vec::new(),
    };

    read_timeline_from_path(&path)
}

/// 从给定路径读取时间轴（方便测试注入 fixture）
pub fn read_timeline_from_path(path: &Path) -> Vec<TimelineMessage> {
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

        match entry_type {
            "user" => {
                // 用户消息：message.content 可能是字符串或 [{type:"text",text:"..."}] 数组
                if let Some(msg) = raw.get("message") {
                    let content = extract_content_text(msg.get("content"));
                    if !content.is_empty() {
                        messages.push(TimelineMessage {
                            role: "user".to_string(),
                            content: truncate(&content, 500),
                            timestamp: format_timestamp(&timestamp),
                        });
                    }
                }
            }
            "assistant" => {
                // 助手消息：提取 text 块
                if let Some(msg) = raw.get("message") {
                    if let Some(content_arr) = msg.get("content").and_then(|c| c.as_array()) {
                        for block in content_arr {
                            let block_type =
                                block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            if block_type == "text" {
                                let text =
                                    block.get("text").and_then(|v| v.as_str()).unwrap_or("");
                                if !text.is_empty() {
                                    messages.push(TimelineMessage {
                                        role: "assistant".to_string(),
                                        content: truncate(text, 500),
                                        timestamp: format_timestamp(&timestamp),
                                    });
                                }
                            }
                        }
                    }
                }
            }
            _ => {} // 跳过 system、summary、file-history-snapshot 等
        }
    }

    // 限制最大消息数，防止超大 IPC 响应
    if messages.len() > 500 {
        messages.truncate(500);
    }
    messages
}

// ============================================================
// 纯辅助函数（可独立单元测试）
// ============================================================

/// 将原始路径编码为 projects/ 下的目录名（来自 retalk claude.rs）
/// Windows: "D:\workspace\geo2" -> "D--workspace-geo2"
/// Unix:    "/home/user/workspace" -> "-home-user-workspace"
pub fn encode_project_path(path: &str) -> String {
    path.replace(":\\", "--")
        .replace('\\', "-")
        .replace('/', "-")
}

/// 尝试从编码目录名反推原始路径（兜底方案，跨平台）（来自 retalk claude.rs）
pub fn decode_project_dir(encoded: &str) -> String {
    if cfg!(windows) {
        // Windows: "D--workspace-geo2" -> "D:\workspace\geo2"
        if let Some(pos) = encoded.find("--") {
            let drive = &encoded[..pos];
            let rest = &encoded[pos + 2..];
            format!("{}:\\{}", drive, rest.replace('-', "\\"))
        } else {
            encoded.to_string()
        }
    } else {
        // Unix: "-home-user-workspace" -> "/home/user/workspace"
        if encoded.starts_with('-') {
            encoded.replace('-', "/")
        } else {
            // 兜底：可能来自 Windows 的编码格式
            if let Some(pos) = encoded.find("--") {
                let drive = &encoded[..pos];
                let rest = &encoded[pos + 2..];
                format!("{}:\\{}", drive, rest.replace('-', "\\"))
            } else {
                encoded.to_string()
            }
        }
    }
}

/// 从 message content 中提取纯文本（来自 retalk claude.rs）
pub fn extract_text_content(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(|item| {
                if item.get("type")?.as_str()? == "text" {
                    item.get("text")?.as_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

// ============================================================
// 内部辅助函数
// ============================================================

/// 在 projects 目录下查找 {session_id}.jsonl 文件（一级子目录）
fn find_session_file(projects_dir: &Path, session_id: &str) -> Option<PathBuf> {
    let target = format!("{}.jsonl", session_id);
    if !projects_dir.exists() {
        return None;
    }
    for entry in fs::read_dir(projects_dir).ok()?.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let file = dir.join(&target);
        if file.exists() {
            return Some(file);
        }
    }
    None
}

/// 提取 Claude 消息内容（兼容字符串和数组格式，用于时间轴）
fn extract_content_text(content: Option<&serde_json::Value>) -> String {
    match content {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|item| {
                if item.get("type")?.as_str()? == "text" {
                    item.get("text")?.as_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
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

    // -------- Step 1-3: 纯辅助函数 TDD --------

    /// 测试 Windows 路径编码解码往返一致性
    #[test]
    fn path_encode_decode_roundtrip_windows() {
        assert_eq!(decode_project_dir("D--workspace-rework"), "D:\\workspace\\rework");
    }

    /// 测试 extract_text_content 兼容字符串和数组两种格式
    #[test]
    fn extract_text_handles_string_and_array() {
        assert_eq!(extract_text_content(&serde_json::json!("hi")), "hi");
        let arr = serde_json::json!([{"type":"text","text":"a"},{"type":"text","text":"b"}]);
        assert_eq!(extract_text_content(&arr), "a\nb");
    }

    // -------- Step 4: fixture 测试 --------

    /// 测试从 fixture 文件解析 session（验证 session_id 和 message_count）
    #[test]
    fn scan_one_parses_fixture() {
        // 使用相对于 CARGO_MANIFEST_DIR 的绝对路径定位 fixture
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/claude/sample.jsonl");
        let session = parse_session_file(
            &fixture,
            "test-session-0001",
            "D:\\workspace\\test-project",
        )
        .expect("fixture 应解析成功");
        assert_eq!(session.session_id, "test-session-0001");
        // fixture 包含 2 条 user 消息
        assert_eq!(session.message_count, 2);
    }

    /// 测试 encode_project_path：Windows 路径编码
    #[test]
    fn encode_windows_path() {
        assert_eq!(encode_project_path("D:\\workspace\\rework"), "D--workspace-rework");
    }

    /// 测试 encode_project_path：Unix 路径编码
    #[test]
    fn encode_unix_path() {
        assert_eq!(encode_project_path("/home/user/workspace"), "-home-user-workspace");
    }

    /// 测试 extract_text_content：非文本 block 被过滤
    #[test]
    fn extract_text_filters_non_text_blocks() {
        let arr = serde_json::json!([
            {"type":"tool_use","name":"bash"},
            {"type":"text","text":"hello"}
        ]);
        assert_eq!(extract_text_content(&arr), "hello");
    }

    /// 测试 classify_event：history.jsonl → FullRescan
    #[test]
    fn classify_event_history_jsonl_is_full_rescan() {
        let provider = ClaudeProvider;
        let claude = AppPaths::detect().claude_dir();
        let history = claude.join("history.jsonl");
        assert_eq!(provider.classify_event(&history), EventKind::FullRescan);
    }

    /// 测试 classify_event：projects 下的 .jsonl → Incremental
    #[test]
    fn classify_event_session_file_is_incremental() {
        let provider = ClaudeProvider;
        let claude = AppPaths::detect().claude_dir();
        let session_file = claude.join("projects").join("D--workspace-foo").join("abc.jsonl");
        assert_eq!(provider.classify_event(&session_file), EventKind::Incremental);
    }

    /// 测试 classify_event：其他路径 → Ignore
    #[test]
    fn classify_event_other_path_is_ignore() {
        let provider = ClaudeProvider;
        assert_eq!(
            provider.classify_event(Path::new("/some/other/path.txt")),
            EventKind::Ignore
        );
    }

    /// 测试 classify_event：子代理转录 <session>/subagents/agent-*.jsonl → Ignore
    /// （不应作为独立会话进入中枢）
    #[test]
    fn classify_event_subagent_transcript_is_ignore() {
        let provider = ClaudeProvider;
        let claude = AppPaths::detect().claude_dir();
        let subagent = claude
            .join("projects")
            .join("D--workspace-foo")
            .join("3b2d24c0-parent")
            .join("subagents")
            .join("agent-a835884d4300b6173.jsonl");
        assert_eq!(provider.classify_event(&subagent), EventKind::Ignore);
    }

    /// 从 fixture 文件读取 Claude 时间轴消息列表（对标 Codex 的 read_timeline_from_codex_fixture）
    #[test]
    fn read_timeline_from_claude_fixture() {
        // sample.jsonl 含：
        //   user(string)  → "请帮我分析这段代码"
        //   assistant(array[text]) → "好的，我来帮你分析。"
        //   user(array[text]) → "能再详细一些吗？"
        //   assistant(array[text]) → "当然，以下是详细分析..."
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/claude/sample.jsonl");
        let messages = read_timeline_from_path(&fixture);

        // 断言：共 4 条消息（2 用户 + 2 助手）
        assert_eq!(messages.len(), 4, "应有 4 条时间轴消息（2 user + 2 assistant）");
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "请帮我分析这段代码");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].content, "好的，我来帮你分析。");
        assert_eq!(messages[2].role, "user");
        assert_eq!(messages[2].content, "能再详细一些吗？");
        assert_eq!(messages[3].role, "assistant");
        assert_eq!(messages[3].content, "当然，以下是详细分析...");
    }

    /// 测试 resume_command 格式正确
    #[test]
    fn resume_command_format() {
        let provider = ClaudeProvider;
        assert_eq!(
            provider.resume_command("D:\\workspace\\foo", "abc-123"),
            "claude --resume abc-123"
        );
    }
}
