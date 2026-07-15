use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// AI 编码工具会话（支持多 provider），从 retalk 移植
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    /// 会话唯一标识符
    pub session_id: String,
    /// provider 名称：如 "claude" / "codex"
    pub provider: String,
    /// 项目所在目录的绝对路径
    pub project_path: String,
    /// 项目名称（通常为目录名）
    pub project_name: String,
    /// 会话的第一条用户提示词
    pub first_prompt: String,
    /// 会话的最后一条用户提示词
    pub last_prompt: String,
    /// 会话创建时间
    pub created_at: DateTime<Utc>,
    /// 会话最后更新时间
    pub updated_at: DateTime<Utc>,
    /// 会话消息总数（含 user + assistant）
    pub message_count: u32,
    /// 所有用户消息列表（用于全文检索）
    pub user_messages: Vec<String>,
    /// 总 token 数（从会话文件中提取）
    pub total_tokens: u64,
}

/// 时间轴消息（会话详情页展示用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineMessage {
    /// 消息角色：如 "user" / "assistant"
    pub role: String,
    /// 消息内容文本
    pub content: String,
    /// ISO 8601 格式的消息时间戳
    pub timestamp: String,
}

/// 会话摘要（同步到 PocketBase 的精简视图）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    /// 会话唯一标识符
    pub session_id: String,
    /// provider 名称
    pub provider: String,
    /// 项目所在目录的绝对路径
    pub project_path: String,
    /// 项目名称
    pub project_name: String,
    /// 最后一条用户提示词
    pub last_prompt: String,
    /// 会话消息总数
    pub message_count: u32,
    /// 总 token 数
    pub total_tokens: u64,
    /// 会话内容哈希（用于增量同步时的变更检测）
    pub content_hash: String,
}
