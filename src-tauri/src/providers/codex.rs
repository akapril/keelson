// providers/codex.rs — Codex CLI provider，从 retalk 移植
// 实现 SessionProvider trait，支持 JSONL 格式的 Codex 会话解析：
// - session_meta → 会话 id + cwd
// - event_msg(user_message) → 用户消息文本
// - event_msg(token_count) → token 累计统计（取最后一条为总量）

use super::claude::{cap_text, MAX_EDITS};
use super::{EventKind, SessionProvider, WatchRoot};
use crate::models::{FileChange, FileEdit, PlannedTask, Session, TimelineMessage};
use crate::paths::AppPaths;
use chrono::{DateTime, Utc};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

/// 时间轴单条消息字符上限：对真实消息等于"不截断"，仅对病态巨型粘贴保留兜底（同 claude）。
const TIMELINE_MSG_CHARS: usize = 20000;

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

    /// argv 版恢复命令：`["codex", "resume", <session_id>]`。
    /// 注意 codex 用**子命令 `resume`**（非 `--resume`），故须覆写默认实现。
    /// session_id 作独立 argv 元素，web 侧直传 CommandBuilder，不经 shell → 无注入面。
    fn resume_argv(&self, _project_path: &str, session_id: &str) -> Vec<String> {
        vec![
            "codex".to_string(),
            "resume".to_string(),
            session_id.to_string(),
        ]
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
    // 会话模型（在 turn_context 行的 payload.model；取首个非空。实证 codex 一会话一模型）
    let mut model = String::new();

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
            Some("turn_context") => {
                // 提取会话模型（首个非空）
                if model.is_empty() {
                    if let Some(payload) = &entry.payload {
                        if let Some(m) = payload.get("model").and_then(|v| v.as_str()) {
                            if !m.is_empty() {
                                model = m.to_string();
                            }
                        }
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

    // 整会话 token 归到该会话唯一模型（一会话一模型近似；无 model → "(unknown)"）
    let mut by_model = std::collections::HashMap::new();
    by_model.insert(
        if model.is_empty() { "(unknown)".to_string() } else { model },
        total_tokens,
    );

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
        by_model,
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
                                content: truncate(text, TIMELINE_MSG_CHARS),
                                timestamp: format_timestamp(&timestamp),
                            });
                        }
                    }
                    "agent_message" => {
                        let text = p.get("message").and_then(|v| v.as_str()).unwrap_or("");
                        if !text.is_empty() {
                            messages.push(TimelineMessage {
                                role: "assistant".to_string(),
                                content: truncate(text, TIMELINE_MSG_CHARS),
                                timestamp: format_timestamp(&timestamp),
                            });
                        }
                    }
                    _ => {} // token_count 等事件不加入时间轴
                }
            }
        }
    }

    // 限制最大消息数，防止超大 IPC 响应。保留**最近** 500 条（truncate 保留开头是 bug）。
    if messages.len() > 500 {
        messages.drain(0..messages.len() - 500);
    }
    messages
}

/// 读取 Codex 会话「规划的任务」——取转录里**最后一次** `update_plan` 的 plan 数组
/// （function_call，name=update_plan，arguments.plan=[{step,status}]）。找不到 → 空。
pub fn read_codex_session_tasks(session_id: &str) -> Vec<PlannedTask> {
    let sessions_dir = AppPaths::detect().codex_dir().join("sessions");
    let path = match find_session_file_recursive(&sessions_dir, session_id) {
        Some(p) => p,
        None => return Vec::new(),
    };
    read_codex_tasks_from_path(&path)
}

/// 从给定路径解析 Codex 规划任务（方便测试注入 fixture）。
pub fn read_codex_tasks_from_path(path: &Path) -> Vec<PlannedTask> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let reader = BufReader::new(file);
    let mut last_plan: Option<Vec<serde_json::Value>> = None;
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if !line.contains("update_plan") {
            continue;
        }
        let raw: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(plan) = find_update_plan(&raw) {
            last_plan = Some(plan); // 保留最后一次（=当前计划状态）
        }
    }
    let plan = match last_plan {
        Some(p) => p,
        None => return Vec::new(),
    };
    plan.iter()
        .enumerate()
        .filter_map(|(i, step)| {
            let text = step.get("step").and_then(|v| v.as_str())?;
            if text.is_empty() {
                return None;
            }
            let status = step
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("pending")
                .to_string();
            Some(PlannedTask {
                id: (i + 1).to_string(), // Codex plan step 无稳定 id，用 1-based 序号
                subject: text.to_string(),
                description: String::new(),
                status,
            })
        })
        .collect()
}

/// 递归在一条 JSON 里找 name=="update_plan" 的对象，返回其 arguments.plan 数组。
/// arguments 可能是对象、也可能是字符串化 JSON（function_call 常见）。
fn find_update_plan(v: &serde_json::Value) -> Option<Vec<serde_json::Value>> {
    match v {
        serde_json::Value::Object(map) => {
            if map.get("name").and_then(|n| n.as_str()) == Some("update_plan") {
                if let Some(args) = map.get("arguments") {
                    let parsed: serde_json::Value = match args {
                        serde_json::Value::String(s) => serde_json::from_str(s).ok()?,
                        other => other.clone(),
                    };
                    if let Some(plan) = parsed.get("plan").and_then(|p| p.as_array()) {
                        return Some(plan.clone());
                    }
                }
            }
            map.values().find_map(find_update_plan)
        }
        serde_json::Value::Array(arr) => arr.iter().find_map(find_update_plan),
        _ => None,
    }
}

// ============================================================
// 会话 → 文件改动溯源（Codex）
// 数据源：转录里 response_item.payload（type=custom_tool_call, name=apply_patch）
// 的 apply_patch 信封。只解析结构化的 apply_patch；经 exec/shell(sed/heredoc)
// 的非结构化改动不在 v1 范围（无法可靠还原）。
// ============================================================

/// 读取指定 Codex 会话的文件改动列表（找不到会话 → 空）。
pub fn read_codex_file_changes(session_id: &str) -> Vec<FileChange> {
    let sessions_dir = AppPaths::detect().codex_dir().join("sessions");
    let path = match find_session_file_recursive(&sessions_dir, session_id) {
        Some(p) => p,
        None => return Vec::new(),
    };
    match fs::read_to_string(&path) {
        Ok(content) => parse_codex_file_changes(&content),
        Err(_) => Vec::new(),
    }
}

/// 纯解析：从会话 .jsonl 全文解析 apply_patch 改动，按文件路径聚合（保持首次出现顺序）。可单测。
pub fn parse_codex_file_changes(content: &str) -> Vec<FileChange> {
    let mut order: Vec<String> = Vec::new();
    let mut by_path: std::collections::HashMap<String, Vec<FileEdit>> =
        std::collections::HashMap::new();
    let mut total = 0usize;

    for line in content.lines() {
        if total >= MAX_EDITS {
            break;
        }
        let raw: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if raw.get("type").and_then(|v| v.as_str()) != Some("response_item") {
            continue;
        }
        // payload.type==custom_tool_call 且 name==apply_patch，input 是 patch 信封
        let payload = match raw.get("payload") {
            Some(p) => p,
            None => continue,
        };
        if payload.get("type").and_then(|v| v.as_str()) != Some("custom_tool_call") {
            continue;
        }
        if payload.get("name").and_then(|v| v.as_str()) != Some("apply_patch") {
            continue;
        }
        let input = payload.get("input").and_then(|v| v.as_str()).unwrap_or("");
        if input.is_empty() {
            continue;
        }
        for (path, edit) in parse_apply_patch(input) {
            if total >= MAX_EDITS {
                break;
            }
            if !by_path.contains_key(&path) {
                order.push(path.clone());
                by_path.insert(path.clone(), Vec::new());
            }
            by_path.get_mut(&path).unwrap().push(edit);
            total += 1;
        }
    }

    order
        .into_iter()
        .map(|p| {
            let edits = by_path.remove(&p).unwrap_or_default();
            FileChange { path: p, edits }
        })
        .collect()
}

/// 解析单个 apply_patch 信封 → (文件路径, 一次改动) 列表。
/// 信封格式：`*** Begin Patch` / `*** Update File: p` / `*** Add File: p` /
/// `*** Delete File: p` / `*** End Patch`。Update 内可含多个 `@@` 块，每块一条改动。
fn parse_apply_patch(input: &str) -> Vec<(String, FileEdit)> {
    let mut out: Vec<(String, FileEdit)> = Vec::new();
    let mut lines = input.lines().peekable();

    while let Some(line) = lines.next() {
        if let Some(p) = line.strip_prefix("*** Update File: ") {
            let path = p.trim().to_string();
            // 收集主体（到下一个 *** 标记为止）
            let mut body: Vec<&str> = Vec::new();
            while let Some(&next) = lines.peek() {
                if next.starts_with("*** ") {
                    break;
                }
                body.push(lines.next().unwrap());
            }
            for (old, new) in split_hunks(&body) {
                out.push((
                    path.clone(),
                    FileEdit { tool: "apply_patch".into(), old: cap_text(&old), new: cap_text(&new) },
                ));
            }
        } else if let Some(p) = line.strip_prefix("*** Add File: ") {
            let path = p.trim().to_string();
            // 新增文件：后续 `+` 前缀行拼成内容
            let mut content = String::new();
            while let Some(&next) = lines.peek() {
                if next.starts_with("*** ") {
                    break;
                }
                let l = lines.next().unwrap();
                let text = l.strip_prefix('+').unwrap_or(l);
                if !content.is_empty() {
                    content.push('\n');
                }
                content.push_str(text);
            }
            out.push((
                path,
                FileEdit { tool: "apply_patch".into(), old: String::new(), new: cap_text(&content) },
            ));
        } else if let Some(p) = line.strip_prefix("*** Delete File: ") {
            // 删除文件：old/new 皆空，tool=apply_patch 供前端识别为删除
            let path = p.trim().to_string();
            out.push((
                path,
                FileEdit { tool: "apply_patch".into(), old: String::new(), new: String::new() },
            ));
        }
        // *** Begin Patch / *** End Patch / 其它 → 忽略
    }
    out
}

/// 把 Update File 主体按 `@@` 分块，每块还原 (old, new)：
/// `-`→仅 old，`+`→仅 new，其余（前导空格/空行=上下文）→同进 old/new。
fn split_hunks(body: &[&str]) -> Vec<(String, String)> {
    let mut hunks: Vec<(String, String)> = Vec::new();
    let mut old = String::new();
    let mut new = String::new();
    let mut dirty = false; // 当前块是否已累积内容

    for &l in body {
        if l.starts_with("@@") {
            // 块边界：flush 上一块
            if dirty {
                hunks.push((std::mem::take(&mut old), std::mem::take(&mut new)));
                dirty = false;
            }
            continue;
        }
        if let Some(rest) = l.strip_prefix('+') {
            if !new.is_empty() {
                new.push('\n');
            }
            new.push_str(rest);
        } else if let Some(rest) = l.strip_prefix('-') {
            if !old.is_empty() {
                old.push('\n');
            }
            old.push_str(rest);
        } else {
            // 上下文行（前导空格）或空行 → 同时进 old/new
            let rest = l.strip_prefix(' ').unwrap_or(l);
            if !old.is_empty() {
                old.push('\n');
            }
            old.push_str(rest);
            if !new.is_empty() {
                new.push('\n');
            }
            new.push_str(rest);
        }
        dirty = true;
    }
    if dirty {
        hunks.push((old, new));
    }
    hunks
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

use super::truncate; // 截断工具已收敛到 providers/mod.rs

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
        // 恒等式：Σ by_model == total_tokens（整会话归一模型 / (unknown)）
        assert_eq!(session.by_model.values().sum::<u64>(), session.total_tokens);

        // 验证项目路径和名称
        assert_eq!(session.project_path, "/home/user/workspace/myproject");
        assert_eq!(session.project_name, "myproject");
    }

    // -------- 文件改动溯源（apply_patch）--------

    /// 构造一行 response_item(custom_tool_call, apply_patch)，input 为给定信封。
    fn apply_patch_line(input: &str) -> String {
        let v = serde_json::json!({
            "type": "response_item",
            "payload": { "type": "custom_tool_call", "name": "apply_patch", "input": input }
        });
        serde_json::to_string(&v).unwrap()
    }

    /// Add File → 整段新增（old 空、new=文件内容）。
    #[test]
    fn parse_codex_add_file() {
        let env = "*** Begin Patch\n*** Add File: src/foo.rs\n+fn main() {}\n+// hi\n*** End Patch";
        let changes = parse_codex_file_changes(&apply_patch_line(env));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, "src/foo.rs");
        assert_eq!(changes[0].edits.len(), 1);
        assert_eq!(changes[0].edits[0].tool, "apply_patch");
        assert_eq!(changes[0].edits[0].old, "");
        assert_eq!(changes[0].edits[0].new, "fn main() {}\n// hi");
    }

    /// Update File → 每个 @@ 块一条改动，old/new 含上下文。
    #[test]
    fn parse_codex_update_file_hunks() {
        let env = "*** Begin Patch\n*** Update File: a.txt\n@@\n ctx\n-old line\n+new line\n@@\n-only removed\n*** End Patch";
        let changes = parse_codex_file_changes(&apply_patch_line(env));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, "a.txt");
        assert_eq!(changes[0].edits.len(), 2, "两个 @@ 块 → 两条改动");
        // 第一块：上下文进 old 和 new
        assert_eq!(changes[0].edits[0].old, "ctx\nold line");
        assert_eq!(changes[0].edits[0].new, "ctx\nnew line");
        // 第二块：纯删除
        assert_eq!(changes[0].edits[1].old, "only removed");
        assert_eq!(changes[0].edits[1].new, "");
    }

    /// Delete File → old/new 皆空、tool=apply_patch（前端据此显示"已删除"）。
    #[test]
    fn parse_codex_delete_file() {
        let env = "*** Begin Patch\n*** Delete File: gone.txt\n*** End Patch";
        let changes = parse_codex_file_changes(&apply_patch_line(env));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, "gone.txt");
        assert_eq!(changes[0].edits[0].old, "");
        assert_eq!(changes[0].edits[0].new, "");
        assert_eq!(changes[0].edits[0].tool, "apply_patch");
    }

    /// 多文件单信封 → 按路径聚合、保持出现顺序。
    #[test]
    fn parse_codex_multi_file_aggregates() {
        let env = "*** Begin Patch\n*** Add File: first.txt\n+one\n*** Update File: second.txt\n@@\n-x\n+y\n*** End Patch";
        let changes = parse_codex_file_changes(&apply_patch_line(env));
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].path, "first.txt"); // 保持出现顺序
        assert_eq!(changes[1].path, "second.txt");
    }

    /// 非 apply_patch 行（普通消息 / update_plan）不产生文件改动。
    #[test]
    fn parse_codex_ignores_non_apply_patch() {
        let jsonl = concat!(
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"hi"}}"#,
            "\n",
            r#"{"type":"response_item","payload":{"type":"function_call","name":"update_plan","arguments":"{}"}}"#,
        );
        assert!(parse_codex_file_changes(jsonl).is_empty());
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

    /// argv 版：codex 用子命令 `resume`；session_id 作独立 argv 元素整体保留。
    #[test]
    fn resume_argv_keeps_session_id_as_single_element() {
        let provider = CodexProvider;
        let argv = provider.resume_argv("/home/user/project", "x; rm -rf /");
        assert_eq!(argv, vec!["codex", "resume", "x; rm -rf /"]);
        assert_eq!(argv[2], "x; rm -rf /");
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
