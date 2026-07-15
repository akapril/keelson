// commands/config.rs — 应用配置读写命令（Task 16）
// MVP 仅覆盖：hotkey（全局快捷键）+ terminal_pref（终端偏好）。
// hotkey 的实际注册由 Task 20/21 处理，此处仅负责持久化。

use crate::AppState;
use tauri::State;

/// 读取当前全局快捷键设置。
#[tauri::command]
pub fn config_get_hotkey(state: State<AppState>) -> String {
    state.config.lock().hotkey.clone()
}

/// 更新全局快捷键并持久化到 config.toml。
///
/// # 注意
/// MVP 阶段此命令**仅持久化**，不重新注册系统级全局快捷键。
/// 实际快捷键注册由 Task 20/21 实现（在此基础上扩展）。
#[tauri::command]
pub fn config_set_hotkey(hotkey: String, state: State<AppState>) -> Result<(), String> {
    // 更新内存中的配置
    let mut cfg = state.config.lock();
    cfg.hotkey = hotkey;
    // 持久化到磁盘
    let config_path = state.paths.app_data.join("config.toml");
    cfg.save(&config_path).map_err(|e| format!("保存配置失败: {e:#}"))
}
