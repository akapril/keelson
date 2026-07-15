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

/// 让 OS 分配一个空闲端口（bind :0 后取端口号再释放）。
pub fn pick_free_port() -> u16 {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8790)
}

/// 轮询 /api/health，直到 200 或超时。
pub async fn wait_healthy(base_url: &str, timeout_ms: u64) -> anyhow::Result<()> {
    let client = reqwest::Client::new();
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
    // 使用 output() 等待命令完成并收集输出
    let output = cmd.output().await?;
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
