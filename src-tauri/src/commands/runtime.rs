//! commands/runtime.rs —— 进程管理「进程」tab 的前端命令层。
//!
//! 进程管理内核已从 claude-runtime 融入 rework 进程内（见 crate::runtime，headless）：
//! rework 启动时在进程内起 daemon（TCP 127.0.0.1:19191 + ~/.claude-runtime store），
//! 与终端 `claude-runtime` CLI 共享同一端口与 store。这里仍以 TCP 客户端方式
//! 与之通信（自连或连外部 daemon 均可），协议：
//! 请求 `{"cmd":"ps"|"logs"|"start"|"stop"|"restart","args":{...}}\n`，响应一行 JSON。
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::time::Duration;

const DAEMON_ADDR: &str = "127.0.0.1:19191";

/// 向 daemon 发一条命令，读回一行 JSON。连接失败（daemon 未运行）→ 友好错误。
fn daemon_call(cmd: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut stream = TcpStream::connect(DAEMON_ADDR)
        .map_err(|_| "进程管理 daemon 未运行（点「立即修复」在进程内拉起）".to_string())?;
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
/// async + spawn_blocking：阻塞 TCP connect 移出主线程，避免冻结 UI（Tauri 同步命令跑主线程）。
#[tauri::command]
pub async fn runtime_available() -> bool {
    tokio::task::spawn_blocking(|| TcpStream::connect(DAEMON_ADDR).is_ok())
        .await
        .unwrap_or(false)
}

/// 供内部（如 /intercept 端点）托管一个进程：向 daemon 发 start。
/// 同步 TCP 调用，调用方若在 async 上下文应放到 spawn_blocking。
pub(crate) fn daemon_start(command: &str, name: &str, cwd: &str) -> Result<serde_json::Value, String> {
    daemon_call(
        "start",
        serde_json::json!({ "command": command, "name": name, "cwd": cwd }),
    )
}

/// 通用透传：把 cmd + args 转发给 daemon，返回其 JSON 响应。
/// 前端用它封装 ps/logs/start/stop/restart（见 ipc.ts）；集中一处，Rust 无需随命令增删。
/// async + spawn_blocking：daemon_call 是阻塞 TCP（且 ps 在 daemon 侧可能耗时近 1s），
/// 移出主线程，避免每次轮询/切 tab 时冻结 UI。
#[tauri::command]
pub async fn runtime_command(
    cmd: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || daemon_call(&cmd, args))
        .await
        .map_err(|e| format!("运行时任务失败：{e}"))?
}

// ─────────────────────── 自检 / 自动启动 / 修复 ───────────────────────

/// 一次性体检结果：给设置页与「进程」tab 展示 + 判断是否需修复。
#[derive(serde::Serialize)]
pub struct RuntimeDiag {
    /// daemon（:19191）是否可连接
    daemon_running: bool,
    /// 运行中的 daemon 是否为 rework 进程内那个（否则为外部 claude-runtime CLI 的）
    embedded: bool,
    /// 当前托管的进程数
    process_count: usize,
}

/// 运行中的 daemon 是否为 rework 进程内那个：对比 PID 文件与本进程 PID。
fn is_embedded_daemon() -> bool {
    let path = crate::runtime::daemon::pid_file_path();
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .map(|pid| pid == std::process::id())
        .unwrap_or(false)
}

/// 体检的阻塞实现（TCP + ps + 读 pid 文件），供 spawn_blocking 调用。
fn diagnose_blocking() -> RuntimeDiag {
    let daemon_running = TcpStream::connect(DAEMON_ADDR).is_ok();
    let process_count = if daemon_running {
        daemon_call("ps", serde_json::json!({}))
            .ok()
            .and_then(|v| v.as_array().map(|a| a.len()))
            .unwrap_or(0)
    } else {
        0
    };
    RuntimeDiag {
        daemon_running,
        embedded: is_embedded_daemon(),
        process_count,
    }
}

/// 体检：daemon 是否在跑 / 是进程内还是外部 / 托管进程数。
/// async + spawn_blocking：阻塞 IO 移出主线程。
#[tauri::command]
pub async fn runtime_diagnose() -> RuntimeDiag {
    tokio::task::spawn_blocking(diagnose_blocking)
        .await
        .unwrap_or(RuntimeDiag {
            daemon_running: false,
            embedded: false,
            process_count: 0,
        })
}

/// 确保 daemon 在运行：已运行直接返回 true；否则在 rework 进程内起 headless daemon
/// 并轮询复检。既作前端"自动启动"入口，也作手动"立即修复"入口。
/// 幂等：外部 claude-runtime daemon 已在跑则内部守卫自动让路。
#[tauri::command]
pub async fn runtime_ensure_daemon() -> Result<bool, String> {
    // 阻塞 TCP connect 放 spawn_blocking；等待用 async sleep，全程不占主线程。
    let connectable = || async {
        tokio::task::spawn_blocking(|| TcpStream::connect(DAEMON_ADDR).is_ok())
            .await
            .unwrap_or(false)
    };
    if connectable().await {
        return Ok(true);
    }
    // 进程内起（不再依赖任何外部二进制/独立进程/第二托盘）。
    crate::runtime::start_embedded();
    // 轮询等待 daemon 绑定端口（进程内起很快，给足 ~2s 兜底）。
    for _ in 0..10 {
        tokio::time::sleep(Duration::from_millis(200)).await;
        if connectable().await {
            return Ok(true);
        }
    }
    Ok(false)
}
