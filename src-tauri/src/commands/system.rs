//! 系统与维护命令：开机自启、PocketBase 存储信息、日志保留天数、清空日志。

use crate::AppState;
use serde::Serialize;
use std::path::Path;
use tauri_plugin_autostart::ManagerExt;

// ─────────────────────────── 开机自启 ────────────────────────────

/// 查询是否已注册开机自启（Win 注册表 Run / mac LaunchAgent / Linux .desktop）。
#[tauri::command]
pub fn autostart_get(app: tauri::AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// 设置开机自启开关。插件负责在各平台写/删自启项并持久化。
#[tauri::command]
pub fn autostart_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let m = app.autolaunch();
    let r = if enabled { m.enable() } else { m.disable() };
    r.map_err(|e| format!("设置开机自启失败: {e}"))
}

// ─────────────────────────── 存储信息 ────────────────────────────

/// PocketBase 存储占用（字节）。
#[derive(Serialize)]
pub struct PbStorageInfo {
    /// 整个 pb_data 目录总大小。
    pub pb_data_bytes: u64,
    /// 日志库 auxiliary.db(+ -wal/-shm) 大小——通常是 pb_data 里最大的一块。
    pub logs_bytes: u64,
    /// 主数据库 data.db 大小（真正的业务数据）。
    pub data_bytes: u64,
    /// 当前日志保留天数（供设置回显）。
    pub retention_days: u32,
}

/// 递归累计目录大小（best-effort，读不到的项跳过）。
fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else { return 0 };
    let mut total = 0u64;
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            total += dir_size(&p);
        } else if let Ok(md) = e.metadata() {
            total += md.len();
        }
    }
    total
}

/// 某文件（含其 SQLite 边车 -wal/-shm）的合计大小。
fn db_group_size(dir: &Path, name: &str) -> u64 {
    ["", "-wal", "-shm"]
        .iter()
        .filter_map(|suf| std::fs::metadata(dir.join(format!("{name}{suf}"))).ok())
        .map(|m| m.len())
        .sum()
}

/// 读取 pb_data 存储占用（供设置「数据与存储」栏展示）。
#[tauri::command]
pub fn pb_storage_info(state: tauri::State<AppState>) -> PbStorageInfo {
    let pb_data = state.paths.app_data.join("pb_data");
    PbStorageInfo {
        pb_data_bytes: dir_size(&pb_data),
        logs_bytes: db_group_size(&pb_data, "auxiliary.db"),
        data_bytes: db_group_size(&pb_data, "data.db"),
        retention_days: state.config.lock().log_retention_days,
    }
}

// ─────────────────────────── 日志保留 / 清空 ────────────────────────────

/// 设置 PocketBase 日志保留天数（1..=365）。写入 config，下次启动 bootstrap 时应用到 PB `logs.maxDays`。
#[tauri::command]
pub fn set_log_retention(state: tauri::State<AppState>, days: u32) -> Result<(), String> {
    let days = days.clamp(1, 365);
    let path = state.paths.app_data.join("config.toml");
    {
        let mut cfg = state.config.lock();
        cfg.log_retention_days = days;
        cfg.save(&path).map_err(|e| format!("保存配置失败: {e}"))?;
    }
    Ok(())
}

/// 标记「下次启动清空日志」：置 clear_logs_pending=true 并存盘。
/// 下次启动 PB 前会删除 auxiliary.db*（PB 重建空库，立即回收磁盘），随后自动复位。
#[tauri::command]
pub fn clear_pb_logs(state: tauri::State<AppState>) -> Result<(), String> {
    let path = state.paths.app_data.join("config.toml");
    {
        let mut cfg = state.config.lock();
        cfg.clear_logs_pending = true;
        cfg.save(&path).map_err(|e| format!("保存配置失败: {e}"))?;
    }
    Ok(())
}
