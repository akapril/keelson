//! PocketBase sidecar 进程生命周期：端口选择、健康检查、启动、superuser 初始化。
use std::path::Path;
use std::time::Duration;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

/// PocketBase 进程句柄，持有服务地址（Task 15 中用于会话同步）。
#[allow(dead_code)]
pub struct PbHandle {
    pub base_url: String,
}

/// 清理可能残留、仍占用 pb_data 的孤儿 PocketBase sidecar（上一实例/上一版本未随进程退出）。
///
/// 背景：重装或异常退出后，旧 PB 可能仍持有 data.db 的 SQLite 写锁；新实例的
/// `superuser upsert`（写操作）会**卡在等锁**上，导致初始化 30s 静默超时。
/// 用 sysinfo 跨平台按进程名（"pocketbase" 前缀，即我方 sidecar `pocketbase-<triple>`）
/// 定位并 kill——无子进程、无控制台黑窗。**在本应用 spawn 自己的 PB 之前调用**：此刻任何
/// pocketbase* 都必是残留，可安全清理。返回清理的进程数。
pub fn kill_orphan_pocketbase() -> usize {
    use sysinfo::{ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut killed = 0usize;
    for proc in sys.processes().values() {
        if proc.name().to_string_lossy().to_lowercase().starts_with("pocketbase") && proc.kill() {
            killed += 1;
            eprintln!("[keelson] 清理残留 PocketBase 进程 pid={}", proc.pid().as_u32());
        }
    }
    killed
}

/// 把初始化错误追加写入 `<app_data>/init-error.log`（带时间戳）。
/// 打包版 GUI 无控制台、stderr 不可见 → 用日志文件让失败可事后定位。best-effort，失败即忽略。
pub fn log_init_error(app_data: &Path, msg: &str) {
    let line = format!("[{}] {msg}\n", chrono::Utc::now().to_rfc3339());
    let path = app_data.join("init-error.log");
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(line.as_bytes());
    }
}

/// 让 OS 分配一个空闲端口（bind :0 后取端口号再释放）。
pub fn pick_free_port() -> u16 {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8790)
}

/// 轮询 /api/health，直到 200 或超时。
pub async fn wait_healthy(base_url: &str, timeout_ms: u64) -> anyhow::Result<()> {
    // 绕过代理：健康检查连本机 PB（见 pb::local_http_client）
    let client = crate::pb::local_http_client();
    let url = format!("{base_url}/api/health");
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        if let Ok(r) = client.get(&url).send().await {
            if r.status().is_success() {
                return Ok(());
            }
        }
        if std::time::Instant::now() >= deadline {
            anyhow::bail!("PocketBase 健康检查超时");
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// 以 sidecar 方式启动 PocketBase，仅绑 127.0.0.1。
pub fn spawn_pocketbase(
    app: &tauri::AppHandle,
    data_dir: &Path,
    migrations_dir: &Path,
    port: u16,
) -> anyhow::Result<CommandChild> {
    let cmd = app.shell().sidecar("pocketbase")?.args([
        "serve",
        "--http",
        &format!("127.0.0.1:{port}"),
        "--dir",
        &data_dir.to_string_lossy(),
        "--migrationsDir",
        &migrations_dir.to_string_lossy(),
    ]);
    let (_rx, child) = cmd.spawn()?;
    Ok(child)
}

/// 通过 sidecar CLI 创建或更新 superuser（幂等）。
/// 在 `spawn_pocketbase` 之前调用，确保首次启动时 superuser 已存在。
pub async fn create_superuser_via_sidecar(
    app: &tauri::AppHandle,
    data_dir: &Path,
    migrations_dir: &Path,
    email: &str,
    password: &str,
) -> anyhow::Result<()> {
    let cmd = app.shell().sidecar("pocketbase")?.args([
        "superuser",
        "upsert",
        email,
        password,
        "--dir",
        &data_dir.to_string_lossy(),
        "--migrationsDir",
        &migrations_dir.to_string_lossy(),
    ]);
    // 使用 output() 等待命令完成并收集输出。加 15s 超时兜底：万一 pb_data 仍被锁（如残留
    // 清理未尽/权限不足），upsert 会无限等锁——超时即清孤儿 PB 释放锁 + 报明确错误，
    // 避免退化成 30s 静默"尚未初始化"。正常 upsert <2s，15s 极宽松。
    let output = match tokio::time::timeout(Duration::from_secs(15), cmd.output()).await {
        Ok(r) => r?,
        Err(_) => {
            let n = kill_orphan_pocketbase();
            anyhow::bail!(
                "superuser upsert 超时（15s）：pb_data 可能被残留的 PocketBase 进程占用，已清理 {n} 个残留进程，请重开应用"
            );
        }
    };
    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("superuser upsert 失败\nstdout: {stdout}\nstderr: {stderr}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pick_free_port_returns_bindable_loopback_port() {
        // 选出的端口应能被再次绑定（说明确实空闲）
        let p = pick_free_port();
        assert!(p >= 1024);
        let ok = std::net::TcpListener::bind(("127.0.0.1", p)).is_ok();
        assert!(ok, "端口 {p} 应可绑定");
    }
}
