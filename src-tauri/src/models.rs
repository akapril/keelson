use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// 会话内一次文件改动（来自转录里的 Write/Edit/MultiEdit 工具调用）。
/// old/new 为截断后的前后文本（Write 时 old 为空、new 为写入内容）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEdit {
    /// 工具名：Write / Edit / MultiEdit
    pub tool: String,
    /// 改动前文本（Write 为空串）
    pub old: String,
    /// 改动后文本
    pub new: String,
}

/// 会话对某个文件的全部改动（按文件聚合，保持首次出现顺序）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    /// 文件绝对路径
    pub path: String,
    /// 该文件的改动序列
    pub edits: Vec<FileEdit>,
}

/// 会话「规划的任务」——Claude 的 TaskCreate/TaskUpdate 落盘状态
/// （~/.claude/tasks/<组>/<n>.json）。用于同步到看板并跟随进度。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannedTask {
    /// 任务序号 id（"1"/"2"/…）
    pub id: String,
    /// 标题
    pub subject: String,
    /// 描述
    pub description: String,
    /// 状态：pending | in_progress | completed
    pub status: String,
}

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
    /// 总 token 数（从会话文件中提取；含 input/output/cache 各类，同口径）
    pub total_tokens: u64,
    /// 按模型的 token 归因（模型名 → token 数；Σ == total_tokens）。
    /// serde default 兼容旧 scan_cache（缺字段反序列化为空 map，不报错）。
    #[serde(default)]
    pub by_model: std::collections::HashMap<String, u64>,
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
