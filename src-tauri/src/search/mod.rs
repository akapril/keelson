/// 搜索子模块：会话全文检索后端
pub mod session_backend;

use serde::{Deserialize, Serialize};

/// 会话搜索命中结果（后续通过 IPC 传至前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHit {
    /// 会话唯一标识符
    pub session_id: String,
    /// 项目名称
    pub project_name: String,
    /// 搜索结果片段（当前使用 first_prompt 作为摘要）
    pub snippet: String,
    /// provider 名称，如 "claude" / "codex"
    pub provider: String,
    /// 更新时间（格式化字符串，如 "07-15 14:30"）
    pub updated_at: String,
    /// Tantivy 相关性评分
    pub score: f32,
}
