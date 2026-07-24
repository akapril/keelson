//! MCP：应用内 HTTP MCP server —— 让本地 claude/codex 操作看板与文档。
//! registry（纯逻辑：schema + 分发）/ tools（handler，打 PB）/ server（rmcp 传输）。
pub mod registry;
pub mod rank;
pub mod tools;
pub mod session_tools;
pub mod server;
// PreToolUse(Bash) 拦截：长驻进程自动托管到进程内 daemon
pub mod intercept;

/// MCP handler 的上下文：以 local-user 身份打 PB。
pub struct McpCtx {
    pub client: crate::pb::client::PbClient,
    pub user_id: String,
}
