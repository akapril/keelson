//! 命令模块：按领域分文件，统一从此 re-export 供 lib.rs 注册。
//!
//! 各子模块均为薄包装层，业务逻辑在 Task 9–15 的底层模块中。

/// MVP 探针命令（保留，用于前端连通性校验）
#[tauri::command]
pub fn ping() -> String {
    "pong".into()
}

// 会话相关命令（sessions_list / sessions_search / sessions_timeline / sessions_project_paths）
pub mod sessions;
// 终端恢复命令（terminal_resume）
pub mod terminal;
// 配置读写命令（config_get_hotkey / config_set_hotkey）
pub mod config;
// 工作台命令（MVP 存根；收藏/备注由前端经 PocketBase 写入）
pub mod workbench;
// git 状态命令（git_info；Board 项目详情的 git 状态条用）
pub mod git;

// 注意：generate_handler! 宏需要使用函数定义所在的原始路径（含辅助符号），
// 故不做 re-export；lib.rs 中直接使用 commands::sessions::sessions_list 等完整路径。
