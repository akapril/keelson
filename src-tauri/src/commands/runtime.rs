//! commands/runtime.rs —— 接入 claude-runtime 的 daemon（进程管理器），
//! 让项目工作台「进程」tab 能看本项目跑的进程 + 日志、start/stop/restart。
//!
//! claude-runtime 是独立二进制 + daemon（TCP 127.0.0.1:19191，行分隔 JSON）：
//! 请求 `{"cmd":"ps"|"logs"|"start"|"stop"|"restart","args":{...}}\n`，响应一行 JSON。
//! rework 不改 claude-runtime，只当它的客户端；daemon 未运行则返回友好提示。
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::time::Duration;

const DAEMON_ADDR: &str = "127.0.0.1:19191";

/// 向 daemon 发一条命令，读回一行 JSON。连接失败（daemon 未运行）→ 友好错误。
fn daemon_call(cmd: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut stream = TcpStream::connect(DAEMON_ADDR)
        .map_err(|_| "claude-runtime daemon 未运行（用 `claude-runtime daemon start` 启动）".to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(5))).ok();

    let req = serde_json::json!({ "cmd": cmd, "args": args });
    stream
        .write_all(format!("{req}\n").as_bytes())
        .map_err(|e| format!("发送失败：{e}"))?;

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|e| format!("读取响应失败：{e}"))?;
    serde_json::from_str(line.trim()).map_err(|e| format!("解析响应失败：{e}"))
}

/// daemon 是否可连接（前端据此显示"未运行"状态）。
#[tauri::command]
pub fn runtime_available() -> bool {
    TcpStream::connect(DAEMON_ADDR).is_ok()
}

/// 通用透传：把 cmd + args 转发给 daemon，返回其 JSON 响应。
/// 前端用它封装 ps/logs/start/stop/restart（见 ipc.ts）；集中一处，Rust 无需随命令增删。
#[tauri::command]
pub fn runtime_command(cmd: String, args: serde_json::Value) -> Result<serde_json::Value, String> {
    daemon_call(&cmd, args)
}
