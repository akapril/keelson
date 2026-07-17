//! RAG：把本地会话历史变成可语义检索的知识库。
//! 分块（chunk）+ 向量存储（store）+ 嵌入（embed），命令层在 commands::rag。
pub mod chunk;
pub mod store;
pub mod embed;

use serde::{Deserialize, Serialize};

/// 一个可嵌入的文本块。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    pub session_id: String,
    pub provider: String,
    pub role: String, // "user" / "assistant"
    pub seq: u32,     // 会话内块序号
    pub text: String,
}

/// 嵌入配置（前端按调用传入，仿 AiConfig）。
#[derive(Debug, Clone, Deserialize)]
pub struct EmbedConfig {
    pub provider: String, // "api" | "local" | "mock"
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}
