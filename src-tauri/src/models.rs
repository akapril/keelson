use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// 会话内一次文件改动（来自转录里的工具调用）。
/// - Claude：Write/Edit/MultiEdit → old/new 为截断后前后文本（Write 时 old 空）。
/// - Codex：apply_patch 信封 → 新增文件 old 空、修改块 old/new 为块前后文、
///   删除文件 old/new 皆空（tool="apply_patch" 供前端识别删除）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEdit {
    /// 工具名：Write / Edit / MultiEdit / apply_patch
    pub tool: String,
    /// 改动前文本（新增文件为空串）
    pub old: String,
    /// 改动后文本（删除文件为空串）
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

/// Claude 文件记忆（~/.claude/projects/<proj>/memory/*.md 的 frontmatter + 正文）。
/// 用于「记忆桥」：扫描后由前端映射写入 rework 记忆账本（默认待审）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMemory {
    /// frontmatter name（唯一 slug，用作幂等锚点）
    pub name: String,
    /// frontmatter description（一句话摘要）
    pub description: String,
    /// frontmatter metadata.type（user/feedback/project/reference），供映射 kind
    pub kind_hint: String,
    /// 正文（frontmatter 之后）
    pub body: String,
    /// 该记忆所属项目的仓库路径（从同目录会话 jsonl 的 cwd 取；取不到为空）。
    /// 前端据此匹配看板项目 → scope=project。编码目录名有损不可反解，故用 cwd。
    pub repo_path: String,
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
