// commands/config.rs — 应用配置读写命令（Task 16 / Task 21 扩展）
// MVP 覆盖：hotkey（全局快捷键）+ terminal_pref（终端偏好）。
// Task 21：config_set_hotkey 现在在持久化的同时，立即重新注册全局快捷键，
//           无需重启即可使新快捷键生效。

use crate::AppState;
use tauri::State;

/// 读取当前全局快捷键设置。
#[tauri::command]
pub fn config_get_hotkey(state: State<AppState>) -> String {
    state.config.lock().hotkey.clone()
}

/// 更新全局快捷键，持久化到 config.toml，并**立即重新注册**全局快捷键。
///
/// Task 21 扩展：通过调用 `register_spotlight_hotkey`，先注销旧快捷键，
/// 再注册新快捷键，无需重启即可生效。
///
/// # 参数
/// - `hotkey` — 新的快捷键字符串，如 "CommandOrControl+Alt+Space"
/// - `app`    — Tauri AppHandle（命令层自动注入），用于访问全局快捷键插件
/// - `state`  — AppState，用于读取路径和写入配置
#[tauri::command]
pub fn config_set_hotkey(
    hotkey: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    // 步骤 1：更新内存中的配置，并持久化到磁盘
    {
        let mut cfg = state.config.lock();
        cfg.hotkey = hotkey.clone();
        let config_path = state.paths.app_data.join("config.toml");
        cfg.save(&config_path).map_err(|e| format!("保存配置失败: {e:#}"))?;
    } // 释放锁，避免在注册快捷键时持有 Mutex

    // 步骤 2：重新注册全局快捷键（注销旧的，注册新的），立即生效
    crate::register_spotlight_hotkey(&app, &hotkey)
        .map_err(|e| {
            // 快捷键注册失败时记录日志，但配置已成功保存（下次启动仍会生效）
            eprintln!("[rework] 热键实时重注册失败（配置已保存，重启后生效）: {e:#}");
            format!("快捷键注册失败（配置已保存，重启后生效）: {e:#}")
        })
}

/// 读取「退出时如何处理受管进程」设置（"keep" / "kill" / "ask"）。
#[tauri::command]
pub fn config_get_exit_behavior(state: State<AppState>) -> String {
    state.config.lock().on_exit_processes.clone()
}

/// 设置「退出时如何处理受管进程」并持久化。仅接受 "keep" / "kill" / "ask"，其余回落 "keep"。
#[tauri::command]
pub fn config_set_exit_behavior(behavior: String, state: State<AppState>) -> Result<(), String> {
    let normalized = match behavior.as_str() {
        "keep" | "kill" | "ask" => behavior,
        _ => "keep".to_string(),
    };
    let mut cfg = state.config.lock();
    cfg.on_exit_processes = normalized;
    let config_path = state.paths.app_data.join("config.toml");
    cfg.save(&config_path).map_err(|e| format!("保存配置失败: {e:#}"))
}
