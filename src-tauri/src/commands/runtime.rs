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

/// 通用透传：把 cmd + args 直接分发给进程管理内核，返回其 JSON 响应。
/// 前端用它封装 ps/logs/start/stop/restart/remove/clean（见 ipc.ts）。
#[tauri::command]
pub async fn runtime_command(cmd: String, args: Value) -> Result<Value, String> {
    Ok(crate::runtime::daemon::dispatch(&cmd, &args).await)
}
