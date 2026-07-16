//! AI 对话命令：统一封装 OpenAI 兼容接口与 Anthropic 原生接口（provider 可切）。
//! 纯粹的请求体构造 / 响应解析拆成可单测的函数；HTTP 收发为薄层。
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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

/// 流式对话：SSE 逐块解析增量文本，经 Channel 实时推送给前端。
#[tauri::command]
pub async fn ai_chat_stream(
    config: AiConfig,
    messages: Vec<ChatMessage>,
    on_event: tauri::ipc::Channel<AiStreamEvent>,
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
}
