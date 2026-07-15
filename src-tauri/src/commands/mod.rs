//! 命令模块。MVP 探针 + 后续分域(Task 16)。
#[tauri::command]
pub fn ping() -> String { "pong".into() }
