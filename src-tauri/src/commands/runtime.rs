//! commands/runtime.rs —— 接入 claude-runtime 的 daemon（进程管理器），
//! 让项目工作台「进程」tab 能看本项目跑的进程 + 日志、start/stop/restart。
//!
//! claude-runtime 是独立二进制 + daemon（TCP 127.0.0.1:19191，行分隔 JSON）：
//! 请求 `{"cmd":"ps"|"logs"|"start"|"stop"|"restart","args":{...}}\n`，响应一行 JSON。
//! rework 不改 claude-runtime，只当它的客户端；daemon 未运行则返回友好提示。
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

const DAEMON_ADDR: &str = "127.0.0.1:19191";
/// Dashboard（HTTP 控制台）地址，daemon 启动时在此监听。
const DASHBOARD_ADDR: &str = "127.0.0.1:19192";
/// PATH 兜底时用的裸命令名。
const BINARY: &str = "claude-runtime";

/// 解析 claude-runtime 可执行文件路径：
/// 优先随包 sidecar——Tauri 打包/`tauri dev` 都会把 externalBin 拷到主程序同目录
/// 并去掉 target triple 后缀（即 主exe同目录/claude-runtime[.exe]），实现最终用户零安装。
/// 找不到再回退 PATH 中的裸命令名（开发者本地 `cargo install` 的场景）。
fn runtime_binary() -> String {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let name = if cfg!(windows) { "claude-runtime.exe" } else { "claude-runtime" };
            let sidecar = dir.join(name);
            if sidecar.exists() {
                return sidecar.to_string_lossy().into_owned();
            }
        }
    }
    BINARY.to_string()
}

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

// ─────────────────────── 自检 / 自动启动 / 修复 ───────────────────────

/// 一次性体检结果：给设置页与「进程」tab 展示 + 判断是否需修复。
#[derive(serde::Serialize)]
pub struct RuntimeDiag {
    /// PATH 中能否找到 claude-runtime 二进制
    binary_found: bool,
    /// 二进制解析到的绝对路径（找不到则空）
    binary_path: String,
    /// `claude-runtime --version` 输出（找不到则空）
    version: String,
    /// daemon（:19191）是否可连接
    daemon_running: bool,
    /// Dashboard（:19192）是否可连接
    dashboard_reachable: bool,
}

/// 解析二进制绝对路径（仅用于展示“装没装、在哪”）：
/// 随包 sidecar 命中则直接返回其绝对路径；否则 PATH 用 where/which 定位。
fn resolve_binary_path() -> Option<String> {
    let b = runtime_binary();
    // 随包 sidecar：runtime_binary 已返回存在的绝对路径。
    if Path::new(&b).is_absolute() {
        return Some(b);
    }
    #[cfg(windows)]
    let locate = Command::new("where").arg(BINARY).output();
    #[cfg(not(windows))]
    let locate = Command::new("which").arg(BINARY).output();

    let out = locate.ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().next().map(|l| l.trim().to_string()).filter(|s| !s.is_empty())
}

/// 读取版本号（顺带确认二进制真的可执行）。找不到/执行失败 → None。
fn read_version() -> Option<String> {
    let out = Command::new(runtime_binary()).arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if v.is_empty() { None } else { Some(v) }
}

/// 体检 claude-runtime：二进制 / 版本 / daemon / dashboard 四项状态一次返回。
#[tauri::command]
pub fn runtime_diagnose() -> RuntimeDiag {
    let binary_path = resolve_binary_path().unwrap_or_default();
    let version = read_version().unwrap_or_default();
    // 能读到版本 或 能定位路径，都算“装了”
    let binary_found = !version.is_empty() || !binary_path.is_empty();
    RuntimeDiag {
        binary_found,
        binary_path,
        version,
        daemon_running: TcpStream::connect(DAEMON_ADDR).is_ok(),
        dashboard_reachable: TcpStream::connect(DASHBOARD_ADDR).is_ok(),
    }
}

/// 以“分离子进程”方式拉起 daemon：`claude-runtime daemon start`。
/// 关键点：daemon start 是前台阻塞进程（主线程跑托盘消息循环），必须 detached
/// 且不 wait，才能让它独立于 rework 存活；子进程句柄丢弃不影响其运行。
fn spawn_daemon_detached() -> Result<(), String> {
    let mut cmd = Command::new(runtime_binary());
    cmd.args(["daemon", "start"]);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS(0x8) 脱离控制台（无黑窗）；
        // CREATE_NEW_PROCESS_GROUP(0x200) 独立进程组，rework 退出不牵连 daemon。
        cmd.creation_flags(0x0000_0008 | 0x0000_0200);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("启动 claude-runtime 失败（PATH 中未找到二进制？）：{e}"))?;
    // 丢弃句柄使其独立运行；不 wait，避免阻塞。
    std::mem::forget(child);
    Ok(())
}

/// 确保 daemon 在运行：已运行直接返回 true；否则 detached 拉起并轮询 ~3s 复检。
/// 既作前端“自动启动”入口，也作手动“立即修复”入口。二进制缺失则 Err（前端提示安装）。
#[tauri::command]
pub fn runtime_ensure_daemon() -> Result<bool, String> {
    // 已在运行：幂等直接返回（避免重复 spawn 出第二个托盘）。
    if TcpStream::connect(DAEMON_ADDR).is_ok() {
        return Ok(true);
    }
    spawn_daemon_detached()?;
    // 轮询等待 daemon 绑定端口（daemon start 主线程先 sleep 2s 再跑托盘，故给足 ~4s）。
    for _ in 0..20 {
        std::thread::sleep(Duration::from_millis(200));
        if TcpStream::connect(DAEMON_ADDR).is_ok() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// 在系统默认浏览器打开 claude-runtime Dashboard（:19192）。
#[tauri::command]
pub fn runtime_open_dashboard() -> Result<(), String> {
    let url = format!("http://{DASHBOARD_ADDR}");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        // explorer 可直接打开 URL，交给系统默认浏览器。
        let mut c = Command::new("explorer");
        c.arg(&url);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(&url);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(&url);
        c
    };
    // explorer 打开 URL 成功时也可能返回非零码，故 spawn 不判状态。
    cmd.spawn().map_err(|e| format!("打开 Dashboard 失败：{e}"))?;
    Ok(())
}
