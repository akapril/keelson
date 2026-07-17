//! MCP：应用内 HTTP MCP server —— 让本地 claude/codex 操作看板与文档。
//! registry（纯逻辑：schema + 分发）/ tools（handler，打 PB）/ server（rmcp 传输）。
pub mod registry;
