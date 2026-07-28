//! Web Gateway 模块：外网可达（绑 0.0.0.0）的 axum HTTP+WS server。
//!
//! 与应用内 MCP server（`src/mcp/server.rs`，绑 127.0.0.1、仅本机）不同，
//! 本 gateway 面向「Web 端 + 外网访问」场景，监听 0.0.0.0，可被同网/外网设备访问。
//!
//! 分阶段落地：
//! - Task 1：骨架 + 起停命令 + 健康路由 `/healthz`（无敏感信息）。
//! - Task 2：认证 core（配对码/token 签发·校验·吊销·限流）。
//! - Task 3：认证中间件（默认拒绝，最外层 layer）+ `/pair`（配对码轮换）+ 静态前端 serve。
//! - 后续：PTY/终端桥接等能力路由（挂在 `/api /pb /ws`，天然受 Task 3 中间件保护）。
pub mod auth;     // Task 2：认证 core（配对码/token 签发·校验·吊销·限流）
pub mod pb_proxy; // Task 6：PB 同源反向代理 `/pb/*`（token 闸内，防 SSRF）
pub mod server;
