// 了解更多 Tauri 命令：https://tauri.app/develop/calling-rust/

/// 示例问候命令，可在后续开发中替换或删除
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 应用入口：注册插件与命令处理器
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用时发生错误");
}
