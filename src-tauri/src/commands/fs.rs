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

/// markdown 文件项（「导入计划」对话框列目录用）。
#[derive(serde::Serialize)]
pub struct MdFile {
    pub name: String,
    pub path: String,
}

/// 读文本文件（导入计划 / 规格用）。不存在或非 UTF-8 → Err。
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {e}"))
}

/// 列目录下的 .md 文件（非递归，按名排序）。目录不存在 → 空列表（非错误，便于前端空态）。
#[tauri::command]
pub fn list_markdown_files(dir: String) -> Result<Vec<MdFile>, String> {
    let d = Path::new(&dir);
    if !d.is_dir() {
        return Ok(vec![]);
    }
    let mut out: Vec<MdFile> = vec![];
    let rd = fs::read_dir(d).map_err(|e| format!("读取目录失败: {e}"))?;
    for entry in rd.flatten() {
        let p = entry.path();
        // 仅收 .md 文件
        if p.extension().and_then(|s| s.to_str()) == Some("md") {
            if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                out.push(MdFile {
                    name: name.to_string(),
                    path: p.to_string_lossy().into_owned(),
                });
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_markdown_missing_dir_is_empty() {
        // 目录不存在应返回空列表而非报错
        let out = list_markdown_files("Z:/no/such/dir/xxxx".into()).unwrap();
        assert!(out.is_empty());
    }

    #[test]
    fn read_missing_file_errors() {
        assert!(read_text_file("Z:/no/such/file.md".into()).is_err());
    }
}
