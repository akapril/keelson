//! runtime —— 从 claude-runtime 融入的进程管理内核（vendored，headless）。
//!
//! 由 claude-runtime/crates/cli 的进程管理模块搬入 rework 进程内运行：
//! 去掉独立系统托盘与 HTTP Dashboard，只保留 daemon 的进程管理内核
//! （store/process/port/health/parser/logs/resources/clean/errors/daemon）。
//!
//! 运行模型：
//! - rework 启动时在进程内起 headless daemon（TCP 127.0.0.1:19191 + ~/.claude-runtime store）；
//! - 与终端 `claude-runtime` CLI 共享同一端口与 store，双方看同一批进程；
//! - 若外部 daemon 已在跑，daemon::run 的 is_daemon_running 守卫会自动让路，
//!   rework 转而当客户端连外部 daemon（零端口冲突，无第二托盘）。
pub mod clean;
pub mod daemon;
pub mod errors;
pub mod health;
pub mod logs;
pub mod parser;
pub mod port;
pub mod process;
pub mod resources;
pub mod store;

/// 在 rework 进程内以 headless 方式启动进程管理 daemon（幂等）。
/// 已有 daemon（本进程或外部）在运行则内部守卫直接返回。
/// 在 Tauri 的 async runtime 中 spawn，长驻直到 rework 退出。
pub fn start_embedded() {
    tauri::async_runtime::spawn(async {
        daemon::run().await;
    });
}
