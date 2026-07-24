//! commands/runtime.rs —— 进程管理「进程」tab 的前端命令层。
//!
//! 进程管理内核在 rework 进程内（crate::runtime，已去 TCP）：命令直接调用
//! daemon::dispatch/handle_*（同进程内函数，无端口、无序列化往返）。
//! 前端 ipc 接口不变：仍用 runtime_command(cmd, args) 封装 ps/logs/start/stop/restart/remove/clean。
use serde_json::Value;

/// 供内部（如 /intercept 端点）托管一个进程：直接调 daemon 的 start handler。
pub(crate) async fn daemon_start(command: &str, name: &str, cwd: &str) -> Value {
    let args = serde_json::json!({ "command": command, "name": name, "cwd": cwd });
    crate::runtime::daemon::dispatch("start", &args).await
}

/// 进程管理是否可用。去 TCP 后为进程内模块，随 rework 恒在 → 恒 true。
/// 保留命令名以兼容前端既有调用。
#[tauri::command]
pub fn runtime_available() -> bool {
    true
}

/// 「确保就绪」——去 TCP 后进程管理随 rework 恒在，恒 Ok(true)。
/// 保留命令名以兼容前端既有调用（自动启动/立即修复）；后续前端清理时一并移除。
#[tauri::command]
pub fn runtime_ensure_daemon() -> Result<bool, String> {
    Ok(true)
}

/// 通用透传：把 cmd + args 直接分发给进程管理内核，返回其 JSON 响应。
/// 前端用它封装 ps/logs/start/stop/restart/remove/clean（见 ipc.ts）。
#[tauri::command]
pub async fn runtime_command(cmd: String, args: Value) -> Result<Value, String> {
    Ok(crate::runtime::daemon::dispatch(&cmd, &args).await)
}

/// 一次性体检结果（保留给设置页展示）。去 TCP 后 daemon 恒在进程内。
#[derive(serde::Serialize)]
pub struct RuntimeDiag {
    /// 进程管理是否就绪（进程内模块，恒 true）
    daemon_running: bool,
    /// 当前托管的进程数
    process_count: usize,
}

/// 体检：进程管理就绪 + 托管进程数（进程内直查，无 TCP）。
#[tauri::command]
pub async fn runtime_diagnose() -> RuntimeDiag {
    let ps = crate::runtime::daemon::dispatch("ps", &serde_json::json!({})).await;
    let process_count = ps.as_array().map(|a| a.len()).unwrap_or(0);
    RuntimeDiag {
        daemon_running: true,
        process_count,
    }
}
