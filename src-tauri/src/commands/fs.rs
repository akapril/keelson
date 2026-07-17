// commands/fs.rs — 通用文本文件写入命令（供导出「另存为」使用）+ 在系统文件管理器打开路径。
// 前端用 dialog 插件的 save() 取得目标路径后，调用此命令把内容写入磁盘。
use std::fs;
use std::path::Path;
use std::process::Command;

/// 将文本内容写入指定绝对路径；父目录不存在时尝试创建。
/// 返回 Result，错误以字符串形式回传前端。
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
    }
    fs::write(p, content).map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(())
}

/// 返回 PocketBase 数据目录（app_data_dir/pb_data）的绝对路径，供设置页「打开数据目录」用。
#[tauri::command]
pub fn pb_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取应用数据目录失败: {e}"))?
        .join("pb_data");
    Ok(dir.to_string_lossy().into_owned())
}

/// 在系统文件管理器中打开指定目录/文件所在位置。
/// 直接用平台命令（explorer / open / xdg-open），不经 shell 插件的 URL 校验，可打开本地目录。
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }
    if !Path::new(&path).exists() {
        return Err(format!("路径不存在: {path}"));
    }
    // 各平台对应的文件管理器打开命令
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("explorer");
        c.arg(&path);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(&path);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(&path);
        c
    };

    // spawn 不等待：文件管理器为长驻进程，只需拉起。
    // 注意：Windows 的 explorer 成功时也可能返回非零退出码，故用 spawn 而非 status。
    cmd.spawn().map_err(|e| format!("打开路径失败: {e}"))?;
    Ok(())
}
