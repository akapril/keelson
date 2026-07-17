//! AI 对话命令：统一封装 OpenAI 兼容接口与 Anthropic 原生接口（provider 可切）。
//! 纯粹的请求体构造 / 响应解析拆成可单测的函数；HTTP 收发为薄层。
use crate::AppState;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;

/// 前端下发的 AI 配置（字段为 snake_case，与 TS 侧一致）。
#[derive(Deserialize, Clone, Debug)]
pub struct AiConfig {
    pub provider: String, // "openai" | "anthropic"
    pub base_url: String, // 可空：空则用官方默认
    pub api_key: String,
    pub model: String,
}

/// 一条对话消息。
#[derive(Deserialize, Clone, Debug)]
pub struct ChatMessage {
    pub role: String, // "system" | "user" | "assistant"
    pub content: String,
}

/// OpenAI 兼容请求体：所有消息（含 system）直接透传。
pub fn openai_body(model: &str, messages: &[ChatMessage]) -> Value {
    json!({
        "model": model,
        "messages": messages
            .iter()
            .map(|m| json!({ "role": m.role, "content": m.content }))
            .collect::<Vec<_>>(),
    })
}

/// Anthropic 请求体：system 抽为顶层字段，其余作为 messages。
pub fn anthropic_body(model: &str, messages: &[ChatMessage]) -> Value {
    let system: String = messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.clone())
        .collect::<Vec<_>>()
        .join("\n\n");
    let msgs: Vec<Value> = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| json!({ "role": m.role, "content": m.content }))
        .collect();
    let mut body = json!({ "model": model, "max_tokens": 4096, "messages": msgs });
    if !system.is_empty() {
        body["system"] = json!(system);
    }
    body
}

/// 解析 OpenAI 响应中的助手文本。
pub fn parse_openai(v: &Value) -> Option<String> {
    v.get("choices")?
        .get(0)?
        .get("message")?
        .get("content")?
        .as_str()
        .map(|s| s.to_string())
}

/// 解析 Anthropic 响应：拼接 content 数组里所有 text 块。
pub fn parse_anthropic(v: &Value) -> Option<String> {
    let arr = v.get("content")?.as_array()?;
    let text: String = arr
        .iter()
        .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join("");
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// 非流式对话：按 provider 组装请求、POST、解析出助手回复文本。
#[tauri::command]
pub async fn ai_chat(config: AiConfig, messages: Vec<ChatMessage>) -> Result<String, String> {
    // 本地 CLI provider：直接调用 claude/codex，绕过 HTTP。
    if crate::commands::cli::is_cli_provider(&config.provider) {
        return crate::commands::cli::run_cli(&config.provider, &messages).await;
    }
    let is_anthropic = config.provider == "anthropic";
    let base = config.base_url.trim_end_matches('/');

    let (url, body) = if is_anthropic {
        let root = if base.is_empty() { "https://api.anthropic.com" } else { base };
        (format!("{root}/v1/messages"), anthropic_body(&config.model, &messages))
    } else {
        let root = if base.is_empty() { "https://api.openai.com/v1" } else { base };
        (format!("{root}/chat/completions"), openai_body(&config.model, &messages))
    };

    let client = reqwest::Client::new();
    let mut rb = client.post(&url).json(&body);
    if is_anthropic {
        rb = rb
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01");
    } else {
        rb = rb.header("authorization", format!("Bearer {}", config.api_key));
    }

    let resp = rb.send().await.map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    if !status.is_success() {
        // 截断错误正文，避免泄露过长内容
        let snippet: String = text.chars().take(300).collect();
        return Err(format!("AI 服务返回 {status}: {snippet}"));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("解析 JSON 失败: {e}"))?;
    let parsed = if is_anthropic { parse_anthropic(&v) } else { parse_openai(&v) };
    parsed.ok_or_else(|| "响应中未找到助手回复".to_string())
}

// ── 工具调用（agent loop 基础层）──────────────────────────
// 前端下发「中性」工具定义 {name, description, parameters(JSON schema)}，
// 按 provider 转成各自线格式。富消息支持 assistant 的 tool_calls 与 tool 结果跨轮传递。

/// 一次工具调用（provider 无关）。arguments 为 JSON 字符串。
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct ToolCallMsg {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

/// 工具对话消息（支持工具调用/结果）。
#[derive(Deserialize, Clone, Debug)]
pub struct ToolChatMessage {
    pub role: String, // system|user|assistant|tool
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub tool_calls: Vec<ToolCallMsg>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
}

/// 一轮模型输出：要么最终文本，要么一批待执行的工具调用。
#[derive(Serialize, Clone, Debug)]
pub struct AiToolTurn {
    pub kind: String, // "text" | "tool_calls"
    pub content: Option<String>,
    pub tool_calls: Vec<ToolCallMsg>,
}

/// OpenAI 单条消息 → 线格式。
fn oa_tool_msg(m: &ToolChatMessage) -> Value {
    match m.role.as_str() {
        "tool" => json!({
            "role": "tool",
            "tool_call_id": m.tool_call_id.clone().unwrap_or_default(),
            "content": m.content.clone().unwrap_or_default(),
        }),
        "assistant" if !m.tool_calls.is_empty() => json!({
            "role": "assistant",
            "content": m.content,
            "tool_calls": m.tool_calls.iter().map(|tc| json!({
                "id": tc.id, "type": "function",
                "function": { "name": tc.name, "arguments": tc.arguments }
            })).collect::<Vec<_>>(),
        }),
        _ => json!({ "role": m.role, "content": m.content.clone().unwrap_or_default() }),
    }
}

/// OpenAI 工具请求体：中性 tools → `{type:function, function:{name,description,parameters}}`。
pub fn openai_tools_body(model: &str, messages: &[ToolChatMessage], tools: &[Value]) -> Value {
    let msgs: Vec<Value> = messages.iter().map(oa_tool_msg).collect();
    let mut b = json!({ "model": model, "messages": msgs });
    if !tools.is_empty() {
        b["tools"] = json!(tools
            .iter()
            .map(|t| json!({
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t["description"],
                    "parameters": t["parameters"],
                }
            }))
            .collect::<Vec<_>>());
    }
    b
}

/// Anthropic 单条消息 → 线格式（content 数组）。
fn an_tool_msg(m: &ToolChatMessage) -> Value {
    match m.role.as_str() {
        "tool" => json!({
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": m.tool_call_id.clone().unwrap_or_default(),
                "content": m.content.clone().unwrap_or_default(),
            }]
        }),
        "assistant" if !m.tool_calls.is_empty() => {
            let mut blocks: Vec<Value> = Vec::new();
            if let Some(c) = &m.content {
                if !c.is_empty() {
                    blocks.push(json!({ "type": "text", "text": c }));
                }
            }
            for tc in &m.tool_calls {
                let input: Value = serde_json::from_str(&tc.arguments).unwrap_or_else(|_| json!({}));
                blocks.push(json!({ "type": "tool_use", "id": tc.id, "name": tc.name, "input": input }));
            }
            json!({ "role": "assistant", "content": blocks })
        }
        _ => json!({ "role": m.role, "content": m.content.clone().unwrap_or_default() }),
    }
}

/// Anthropic 工具请求体：system 抽顶层；中性 tools → `{name,description,input_schema}`。
pub fn anthropic_tools_body(model: &str, messages: &[ToolChatMessage], tools: &[Value]) -> Value {
    let system: String = messages
        .iter()
        .filter(|m| m.role == "system")
        .filter_map(|m| m.content.clone())
        .collect::<Vec<_>>()
        .join("\n\n");
    let msgs: Vec<Value> = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(an_tool_msg)
        .collect();
    let mut body = json!({ "model": model, "max_tokens": 4096, "messages": msgs });
    if !system.is_empty() {
        body["system"] = json!(system);
    }
    if !tools.is_empty() {
        body["tools"] = json!(tools
            .iter()
            .map(|t| json!({
                "name": t["name"],
                "description": t["description"],
                "input_schema": t["parameters"],
            }))
            .collect::<Vec<_>>());
    }
    body
}

/// 解析 OpenAI 一轮输出（有 tool_calls 则返回工具调用，否则文本）。
pub fn parse_openai_turn(v: &Value) -> AiToolTurn {
    let msg = &v["choices"][0]["message"];
    if let Some(tcs) = msg["tool_calls"].as_array() {
        let calls: Vec<ToolCallMsg> = tcs
            .iter()
            .filter_map(|tc| {
                Some(ToolCallMsg {
                    id: tc["id"].as_str()?.to_string(),
                    name: tc["function"]["name"].as_str()?.to_string(),
                    arguments: tc["function"]["arguments"].as_str().unwrap_or("{}").to_string(),
                })
            })
            .collect();
        if !calls.is_empty() {
            return AiToolTurn {
                kind: "tool_calls".into(),
                content: msg["content"].as_str().map(|s| s.to_string()),
                tool_calls: calls,
            };
        }
    }
    AiToolTurn {
        kind: "text".into(),
        content: msg["content"].as_str().map(|s| s.to_string()),
        tool_calls: Vec::new(),
    }
}

/// 解析 Anthropic 一轮输出（有 tool_use 块则返回工具调用，否则拼接文本）。
pub fn parse_anthropic_turn(v: &Value) -> AiToolTurn {
    let empty = Vec::new();
    let blocks = v["content"].as_array().unwrap_or(&empty);
    let mut text = String::new();
    let mut calls: Vec<ToolCallMsg> = Vec::new();
    for b in blocks {
        match b["type"].as_str() {
            Some("text") => {
                if let Some(t) = b["text"].as_str() {
                    text.push_str(t);
                }
            }
            Some("tool_use") => {
                if let (Some(id), Some(name)) = (b["id"].as_str(), b["name"].as_str()) {
                    calls.push(ToolCallMsg {
                        id: id.to_string(),
                        name: name.to_string(),
                        arguments: b["input"].to_string(),
                    });
                }
            }
            _ => {}
        }
    }
    let content = if text.is_empty() { None } else { Some(text) };
    if !calls.is_empty() {
        AiToolTurn { kind: "tool_calls".into(), content, tool_calls: calls }
    } else {
        AiToolTurn { kind: "text".into(), content, tool_calls: Vec::new() }
    }
}

/// 一轮工具对话（命令）：组装（含 tools）→ POST → 解析出「文本」或「工具调用」。
/// agent loop 由前端驱动：执行工具后把结果作为 tool 消息回传，再次调用本命令。
#[tauri::command]
pub async fn ai_chat_tools(
    config: AiConfig,
    messages: Vec<ToolChatMessage>,
    tools: Vec<Value>,
) -> Result<AiToolTurn, String> {
    let is_anthropic = config.provider == "anthropic";
    let base = config.base_url.trim_end_matches('/');

    let (url, body) = if is_anthropic {
        let root = if base.is_empty() { "https://api.anthropic.com" } else { base };
        (
            format!("{root}/v1/messages"),
            anthropic_tools_body(&config.model, &messages, &tools),
        )
    } else {
        let root = if base.is_empty() { "https://api.openai.com/v1" } else { base };
        (
            format!("{root}/chat/completions"),
            openai_tools_body(&config.model, &messages, &tools),
        )
    };

    let client = reqwest::Client::new();
    let mut rb = client.post(&url).json(&body);
    if is_anthropic {
        rb = rb
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01");
    } else {
        rb = rb.header("authorization", format!("Bearer {}", config.api_key));
    }

    let resp = rb.send().await.map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    if !status.is_success() {
        let snippet: String = text.chars().take(300).collect();
        return Err(format!("AI 服务返回 {status}: {snippet}"));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("解析 JSON 失败: {e}"))?;
    Ok(if is_anthropic {
        parse_anthropic_turn(&v)
    } else {
        parse_openai_turn(&v)
    })
}

// ── 流式对话 ──────────────────────────────────────────────

/// 推送给前端的流式事件（通过 Tauri Channel）。
#[derive(Serialize, Clone)]
pub struct AiStreamEvent {
    pub kind: String, // "delta" | "done" | "error"
    pub text: Option<String>,
}

/// 解析 OpenAI SSE 行的增量文本（`data: {...delta.content}`；`[DONE]`/非 data 行返回 None）。
pub fn parse_openai_sse(line: &str) -> Option<String> {
    let data = line.strip_prefix("data:")?.trim();
    if data.is_empty() || data == "[DONE]" {
        return None;
    }
    let v: Value = serde_json::from_str(data).ok()?;
    v.get("choices")?
        .get(0)?
        .get("delta")?
        .get("content")?
        .as_str()
        .map(|s| s.to_string())
}

/// 解析 Anthropic SSE 行的增量文本（仅 `content_block_delta` 的 `delta.text`）。
pub fn parse_anthropic_sse(line: &str) -> Option<String> {
    let data = line.strip_prefix("data:")?.trim();
    if data.is_empty() {
        return None;
    }
    let v: Value = serde_json::from_str(data).ok()?;
    if v.get("type")?.as_str()? != "content_block_delta" {
        return None;
    }
    v.get("delta")?.get("text")?.as_str().map(|s| s.to_string())
}

/// 流式对话（命令入口）：注册取消标志 → 执行流式 → 清理标志。
#[tauri::command]
pub async fn ai_chat_stream(
    config: AiConfig,
    messages: Vec<ChatMessage>,
    stream_id: String,
    on_event: tauri::ipc::Channel<AiStreamEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 本地 CLI provider：逐行读取 stdout，按 delta 事件推送；不复用 HTTP 取消标志。
    if crate::commands::cli::is_cli_provider(&config.provider) {
        let result = crate::commands::cli::run_cli_stream(
            &config.provider,
            &messages,
            |line| {
                let _ = on_event.send(AiStreamEvent {
                    kind: "delta".into(),
                    text: Some(format!("{line}\n")),
                });
            },
        )
        .await;
        match result {
            Ok(()) => {
                let _ = on_event.send(AiStreamEvent { kind: "done".into(), text: None });
                return Ok(());
            }
            Err(e) => {
                let _ = on_event.send(AiStreamEvent { kind: "error".into(), text: Some(e) });
                return Ok(());
            }
        }
    }
    // 注册本次流的取消标志
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .ai_cancels
        .lock()
        .insert(stream_id.clone(), cancel.clone());
    // 执行流式（无论成功/失败都清理标志）
    let result = ai_stream_run(config, messages, &cancel, &on_event).await;
    state.ai_cancels.lock().remove(&stream_id);
    result
}

/// 取消一个进行中的流式对话（设置其取消标志，流循环下一轮会跳出）。
#[tauri::command]
pub fn ai_cancel_stream(stream_id: String, state: State<'_, AppState>) {
    if let Some(flag) = state.ai_cancels.lock().get(&stream_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

/// 流式核心：SSE 逐块解析增量文本，经 Channel 实时推送；每轮检查取消标志。
async fn ai_stream_run(
    config: AiConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    on_event: &tauri::ipc::Channel<AiStreamEvent>,
) -> Result<(), String> {
    let is_anthropic = config.provider == "anthropic";
    let base = config.base_url.trim_end_matches('/');

    let (url, mut body) = if is_anthropic {
        let root = if base.is_empty() { "https://api.anthropic.com" } else { base };
        (format!("{root}/v1/messages"), anthropic_body(&config.model, &messages))
    } else {
        let root = if base.is_empty() { "https://api.openai.com/v1" } else { base };
        (format!("{root}/chat/completions"), openai_body(&config.model, &messages))
    };
    body["stream"] = json!(true);

    let client = reqwest::Client::new();
    let mut rb = client.post(&url).json(&body);
    if is_anthropic {
        rb = rb
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01");
    } else {
        rb = rb.header("authorization", format!("Bearer {}", config.api_key));
    }

    let resp = rb.send().await.map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let snippet: String = text.chars().take(300).collect();
        let msg = format!("AI 服务返回 {status}: {snippet}");
        let _ = on_event.send(AiStreamEvent { kind: "error".into(), text: Some(msg.clone()) });
        return Err(msg);
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        // 用户请求停止：跳出（保留已生成内容）
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let bytes = chunk.map_err(|e| format!("读取流失败: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&bytes));
        // 逐行处理已完整到达的 SSE 行
        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            let line = line.trim_end();
            let delta = if is_anthropic {
                parse_anthropic_sse(line)
            } else {
                parse_openai_sse(line)
            };
            if let Some(text) = delta {
                on_event
                    .send(AiStreamEvent { kind: "delta".into(), text: Some(text) })
                    .map_err(|e| format!("推送失败: {e}"))?;
            }
        }
    }
    let _ = on_event.send(AiStreamEvent { kind: "done".into(), text: None });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msgs() -> Vec<ChatMessage> {
        vec![
            ChatMessage { role: "system".into(), content: "sys".into() },
            ChatMessage { role: "user".into(), content: "hi".into() },
        ]
    }

    #[test]
    fn openai_body_includes_all_messages() {
        let b = openai_body("gpt-4o", &msgs());
        assert_eq!(b["model"], "gpt-4o");
        assert_eq!(b["messages"].as_array().unwrap().len(), 2);
        assert_eq!(b["messages"][0]["role"], "system");
    }

    #[test]
    fn anthropic_body_extracts_system() {
        let b = anthropic_body("claude-x", &msgs());
        assert_eq!(b["system"], "sys");
        assert_eq!(b["messages"].as_array().unwrap().len(), 1);
        assert_eq!(b["messages"][0]["role"], "user");
        assert_eq!(b["max_tokens"], 4096);
    }

    #[test]
    fn parse_openai_extracts_content() {
        let v = json!({ "choices": [{ "message": { "content": "hello" } }] });
        assert_eq!(parse_openai(&v), Some("hello".to_string()));
    }

    #[test]
    fn parse_anthropic_joins_text_blocks() {
        let v = json!({ "content": [{ "type": "text", "text": "a" }, { "type": "text", "text": "b" }] });
        assert_eq!(parse_anthropic(&v), Some("ab".to_string()));
    }

    #[test]
    fn parse_handles_missing_fields() {
        assert_eq!(parse_openai(&json!({})), None);
        assert_eq!(parse_anthropic(&json!({ "content": [] })), None);
    }

    #[test]
    fn openai_sse_extracts_delta() {
        assert_eq!(
            parse_openai_sse("data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}"),
            Some("Hi".to_string())
        );
        assert_eq!(parse_openai_sse("data: [DONE]"), None);
        assert_eq!(parse_openai_sse("event: foo"), None);
        assert_eq!(parse_openai_sse(""), None);
    }

    #[test]
    fn anthropic_sse_extracts_delta() {
        assert_eq!(
            parse_anthropic_sse(
                "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}"
            ),
            Some("Hi".to_string())
        );
        assert_eq!(parse_anthropic_sse("data: {\"type\":\"message_stop\"}"), None);
        assert_eq!(parse_anthropic_sse("event: content_block_delta"), None);
    }

    // ── 工具调用 ──────────────────────────────────────────
    fn tool_defs() -> Vec<Value> {
        vec![json!({
            "name": "create_task",
            "description": "创建看板任务",
            "parameters": { "type": "object", "properties": { "title": { "type": "string" } }, "required": ["title"] }
        })]
    }

    #[test]
    fn openai_tools_body_wraps_function_schema() {
        let msgs = vec![ToolChatMessage {
            role: "user".into(),
            content: Some("建个任务".into()),
            tool_calls: vec![],
            tool_call_id: None,
        }];
        let b = openai_tools_body("gpt-4o", &msgs, &tool_defs());
        assert_eq!(b["tools"][0]["type"], "function");
        assert_eq!(b["tools"][0]["function"]["name"], "create_task");
        assert!(b["tools"][0]["function"]["parameters"].is_object());
    }

    #[test]
    fn openai_tool_result_and_assistant_calls_mapped() {
        let msgs = vec![
            ToolChatMessage {
                role: "assistant".into(),
                content: None,
                tool_calls: vec![ToolCallMsg {
                    id: "c1".into(),
                    name: "create_task".into(),
                    arguments: "{\"title\":\"x\"}".into(),
                }],
                tool_call_id: None,
            },
            ToolChatMessage {
                role: "tool".into(),
                content: Some("ok".into()),
                tool_calls: vec![],
                tool_call_id: Some("c1".into()),
            },
        ];
        let b = openai_tools_body("m", &msgs, &[]);
        assert_eq!(b["messages"][0]["tool_calls"][0]["id"], "c1");
        assert_eq!(b["messages"][0]["tool_calls"][0]["function"]["name"], "create_task");
        assert_eq!(b["messages"][1]["role"], "tool");
        assert_eq!(b["messages"][1]["tool_call_id"], "c1");
    }

    #[test]
    fn anthropic_tools_body_maps_input_schema_and_blocks() {
        let msgs = vec![
            ToolChatMessage { role: "system".into(), content: Some("sys".into()), tool_calls: vec![], tool_call_id: None },
            ToolChatMessage {
                role: "assistant".into(),
                content: None,
                tool_calls: vec![ToolCallMsg { id: "u1".into(), name: "create_task".into(), arguments: "{\"title\":\"x\"}".into() }],
                tool_call_id: None,
            },
            ToolChatMessage { role: "tool".into(), content: Some("done".into()), tool_calls: vec![], tool_call_id: Some("u1".into()) },
        ];
        let b = anthropic_tools_body("claude", &msgs, &tool_defs());
        assert_eq!(b["system"], "sys");
        assert_eq!(b["tools"][0]["name"], "create_task");
        assert!(b["tools"][0]["input_schema"].is_object());
        // assistant tool_use 块
        assert_eq!(b["messages"][0]["content"][0]["type"], "tool_use");
        assert_eq!(b["messages"][0]["content"][0]["input"]["title"], "x");
        // tool 结果 → user + tool_result
        assert_eq!(b["messages"][1]["role"], "user");
        assert_eq!(b["messages"][1]["content"][0]["type"], "tool_result");
        assert_eq!(b["messages"][1]["content"][0]["tool_use_id"], "u1");
    }

    #[test]
    fn parse_openai_turn_detects_tool_calls() {
        let v = json!({ "choices": [{ "message": {
            "content": null,
            "tool_calls": [{ "id": "c1", "type": "function", "function": { "name": "create_task", "arguments": "{\"title\":\"x\"}" } }]
        }}]});
        let t = parse_openai_turn(&v);
        assert_eq!(t.kind, "tool_calls");
        assert_eq!(t.tool_calls[0].name, "create_task");
        assert_eq!(t.tool_calls[0].id, "c1");
    }

    #[test]
    fn parse_openai_turn_plain_text() {
        let v = json!({ "choices": [{ "message": { "content": "done" } }] });
        let t = parse_openai_turn(&v);
        assert_eq!(t.kind, "text");
        assert_eq!(t.content, Some("done".to_string()));
        assert!(t.tool_calls.is_empty());
    }

    #[test]
    fn parse_anthropic_turn_detects_tool_use() {
        let v = json!({ "content": [
            { "type": "text", "text": "我来建" },
            { "type": "tool_use", "id": "u1", "name": "create_task", "input": { "title": "x" } }
        ]});
        let t = parse_anthropic_turn(&v);
        assert_eq!(t.kind, "tool_calls");
        assert_eq!(t.tool_calls[0].name, "create_task");
        assert_eq!(t.content, Some("我来建".to_string()));
        // arguments 是 input 的 JSON 串
        assert!(t.tool_calls[0].arguments.contains("title"));
    }

    #[test]
    fn parse_anthropic_turn_plain_text() {
        let v = json!({ "content": [{ "type": "text", "text": "hi" }] });
        let t = parse_anthropic_turn(&v);
        assert_eq!(t.kind, "text");
        assert_eq!(t.content, Some("hi".to_string()));
    }
}
