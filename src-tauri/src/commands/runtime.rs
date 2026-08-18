//! commands/runtime.rs —— 进程管理「进程」tab 的前端命令层。
//!
//! 进程管理内核在 rework 进程内（crate::runtime，已去 TCP）：命令直接调用
//! daemon::dispatch/handle_*（同进程内函数，无端口、无序列化往返）。
//! 前端 ipc 接口不变：仍用 runtime_command(cmd, args) 封装 ps/logs/start/stop/restart/remove/clean。
use serde_json::Value;
use tauri::State;
use crate::AppState;
use crate::pb::client::PbClient;

// ─────────────────────────── RuntimeStatus ────────────────────────────

/// 「本地运行时」聚合状态：机器资源 + agent 容量 + 健康/时长 + 磁盘。
#[derive(serde::Serialize)]
pub struct RuntimeStatus {
    /// 全机 CPU 使用率（0.0–100.0）
    pub cpu_percent: f32,
    /// 已用物理内存（字节）
    pub mem_used: u64,
    /// 总物理内存（字节）
    pub mem_total: u64,
    /// 内存人类可读展示，如 "5.2 GB / 16 GB"
    pub mem_display: String,
    /// 当前正在运行的 agent 任务数
    pub agent_running: u32,
    /// agent 全局并发上限
    pub agent_cap: u32,
    /// 应用已运行秒数
    pub uptime_secs: u64,
    /// pb_data + runtime_dir 总磁盘字节数
    pub disk_bytes: u64,
    /// 磁盘人类可读展示，如 "1.3 GB"
    pub disk_display: String,
    /// PocketBase agent_runs 查询是否成功
    pub pb_ok: bool,
    /// 受管进程中 status=="running" 的数量
    pub proc_count: u32,
}

/// 「本地运行时」面板聚合命令（S4）：一次 IPC 拿到机器资源 + agent 容量 + 磁盘 + uptime。
///
/// - CPU/内存采样（含 ~200ms 睡眠）和磁盘递归计算都在 spawn_blocking 里跑，不冻 UI 线程。
/// - auth guard 在短作用域内取完即释放，不跨 await 持有（parking_lot Mutex 不 Send）。
#[tauri::command]
pub async fn runtime_status(
    state: State<'_, AppState>,
) -> Result<RuntimeStatus, String> {
    // 1) 阻塞部分（CPU 两次采样含睡眠 + 磁盘递归）走 spawn_blocking，不冻 UI
    let pb_data = state.paths.app_data.join("pb_data");
    let rt_dir = crate::runtime::store::runtime_dir();
    let (cpu_percent, mem_used, mem_total, disk_bytes) =
        tokio::task::spawn_blocking(move || {
            let (cpu, used, total) = crate::runtime::sysmon::system_usage();
            let disk = crate::runtime::disk::dir_size(&pb_data)
                .saturating_add(crate::runtime::disk::dir_size(&rt_dir));
            (cpu, used, total, disk)
        })
        .await
        .map_err(|e| e.to_string())?;

    // 2) agent 在跑数（查 PB agent_runs status=running）——auth 未就绪则计 0。
    //    auth guard 必须在短作用域内取值后立即 drop，绝不跨 await 持有。
    let (agent_running, pb_ok) = {
        // 短作用域：clone base_url / token 后 guard 自动释放
        let auth = {
            let g = state.auth.lock();
            g.as_ref().map(|a| (a.base_url.clone(), a.token.clone()))
        };
        match auth {
            Some((base, token)) => {
                let client = PbClient::new(&base, &token);
                match client
                    .list("agent_runs", "status = \"running\" && deleted_at = \"\"", "id")
                    .await
                {
                    Ok(rows) => (rows.len() as u32, true),
                    Err(_) => (0, false),
                }
            }
            None => (0, false),
        }
    };

    // 3) 受管进程中 status=="running" 的数量
    let proc_count = crate::runtime::store::load_processes()
        .iter()
        .filter(|e| e.status == "running")
        .count() as u32;

    // 4) uptime + 格式化展示
    let uptime_secs = state.started_at.elapsed().as_secs();
    let mem_display = format!(
        "{} / {}",
        crate::runtime::resources::format_bytes(mem_used),
        crate::runtime::resources::format_bytes(mem_total),
    );
    let disk_display = crate::runtime::resources::format_bytes(disk_bytes);

    Ok(RuntimeStatus {
        cpu_percent,
        mem_used,
        mem_total,
        mem_display,
        agent_running,
        agent_cap: crate::agent::worker::AGENT_CONCURRENCY_GLOBAL_CAP as u32,
        uptime_secs,
        disk_bytes,
        disk_display,
        pb_ok,
        proc_count,
    })
}

/// 供内部（如 /intercept 端点）托管一个进程：直接调 daemon 的 start handler。
/// session_id/provider 可选（intercept 自动托管时带上，做进程→会话溯源）。
pub(crate) async fn daemon_start(
    command: &str,
    name: &str,
    cwd: &str,
    session_id: Option<&str>,
    provider: Option<&str>,
) -> Value {
    let args = serde_json::json!({
        "command": command,
        "name": name,
        "cwd": cwd,
        "session_id": session_id,
        "provider": provider,
    });
    crate::runtime::daemon::dispatch("start", &args).await
}

/// 通用透传：把 cmd + args 直接分发给进程管理内核，返回其 JSON 响应。
/// 前端用它封装 ps/logs/start/stop/restart/remove/clean（见 ipc.ts）。
#[tauri::command]
pub async fn runtime_command(cmd: String, args: Value) -> Result<Value, String> {
    Ok(crate::runtime::daemon::dispatch(&cmd, &args).await)
}
