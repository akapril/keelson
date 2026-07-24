//! runtime —— rework 进程内的进程管理内核（源自 claude-runtime，已去 TCP 层）。
//!
//! 进程管理模块（store/process/port/health/parser/logs/resources/clean/errors/daemon）
//! 搬入 rework 进程内。**去掉了独立 TCP daemon（:19191）、pid 文件、多实例守卫**：
//! 前端命令经 commands/runtime.rs 直接调用 daemon::dispatch/handle_*（同进程内，无端口、
//! 无序列化往返）。数据仍在 ~/.claude-runtime（processes.json + stdout/<id>.log）。
//! 不再与外部 claude-runtime CLI 通信（该外部工具已弃用）。
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

/// 启动进程管理的后台任务（health 检查 / 旧日志清理）。
/// 去 TCP 后进程管理为纯进程内模块——前端命令直调 daemon::dispatch，无需起 daemon server。
/// 注：从 tauri setup（非 async）调用，故包一层 tauri::async_runtime::spawn，
/// 使 daemon::start_background_tasks 内部的 tokio::spawn 在 tokio runtime 上下文里执行
/// （否则报 "there is no reactor running"）。
pub fn start_background_tasks() {
    tauri::async_runtime::spawn(async {
        daemon::start_background_tasks();
    });
}

/// 起后台任务：进程表一有变更就 emit "runtime-processes-changed" 给前端，
/// 让「进程」tab 像活动流一样「一有数据就显示」（不必等轮询）。100ms 去抖合并突发变更。
pub fn start_change_emitter(app: tauri::AppHandle) {
    use tauri::Emitter;
    tauri::async_runtime::spawn(async move {
        loop {
            store::change_notify().notified().await;
            // 去抖：合并 100ms 内的连续变更为一次 emit（如批量端口检测/健康更新）
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            let _ = app.emit("runtime-processes-changed", ());
        }
    });
}
