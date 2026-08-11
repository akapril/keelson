//! 桌面交互式 PTY 进程命令：start/input/resize/kill。emit 需 AppHandle，故独立于 runtime_command。

use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::AppState;
use crate::runtime::store::{self, ProcessEntry};

/// 交互式启动：跑 PTY、写进程表（interactive=true，max_restarts 强制 0），返回条目 JSON。
#[tauri::command]
pub async fn runtime_pty_start(
    app: AppHandle,
    state: State<'_, AppState>,
    command: String,
    name: String,
    cwd: String,
) -> Result<serde_json::Value, String> {
    let command = command.trim().to_string();
    if command.is_empty() {
        return Err("命令为空".to_string());
    }
    // 名称已被占用则拒绝（交互进程不支持重启，用户需手动 kill 再重开）
    if store::find_process(&name).is_some() {
        return Err(format!("进程名称 '{name}' 已存在，请先停止该进程"));
    }

    // 生成唯一 id（取 UUID 前 6 位，足够区分少量并发会话）
    let id = Uuid::new_v4().to_string()[..6].to_string();
    let log_path = store::stdout_dir().join(format!("{id}.log"));

    // 先建日志文件（tee 目标；reader 线程 append 打开）
    std::fs::File::create(&log_path).map_err(|e| format!("无法创建日志文件: {e}"))?;

    // 交互式 PTY 不额外注入环境变量（由命令本身携带 / 用户在命令里指定）
    let env = std::collections::HashMap::new();
    state
        .runtime_pty
        .open(app, &id, &command, &cwd, &env, log_path)?;

    // 字段严格对齐 store.rs 的 ProcessEntry 定义（health 是 String 非 Option；有 env 字段）。
    let entry = ProcessEntry {
        id: id.clone(),
        name: name.clone(),
        command: command.clone(),
        cwd: cwd.clone(),
        pid: 0, // 交互 PTY 由 registry 持 child；PID 判活对其不适用（Task 4 跳过），靠 exit 事件清理
        port: Vec::new(),
        status: "running".to_string(),
        started_at: chrono::Utc::now(),
        max_restarts: 0, // 交互进程强制不接看门狗
        restart_count: 0,
        health_url: None,
        health: "unknown".to_string(),
        env: std::collections::HashMap::new(),
        session_id: None,
        provider: None,
        interactive: true,
        label: None,
        note: None,
    };
    store::add_process(entry.clone());

    serde_json::to_value(&entry).map_err(|e| format!("序列化进程条目失败: {e}"))
}

/// 向交互 PTY 写 stdin（键入/密码）。data 为原始字节，绝不落日志。
#[tauri::command]
pub async fn runtime_pty_input(
    state: State<'_, AppState>,
    id: String,
    data: String,
) -> Result<(), String> {
    state.runtime_pty.input(&id, data.as_bytes())
}

/// 调整交互 PTY 尺寸（前端 resize 时同步，触发子进程 SIGWINCH/重排）。
#[tauri::command]
pub async fn runtime_pty_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.runtime_pty.resize(&id, cols, rows)
}

/// 停止交互 PTY 会话：interactive 进程 pid=0，不能走 daemon 的 PID kill，必须经 registry。
/// kill 后把进程表条目标 exited（reader 线程收到 EOF 亦会标，双保险幂等）。
#[tauri::command]
pub async fn runtime_pty_kill(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let res = state.runtime_pty.kill(&id);
    // 无论 kill 成败都将进程表条目标为 exited（已移除出 registry = 不再运行）
    store::update_process(&id, |e| e.status = "exited".to_string());
    res
}
