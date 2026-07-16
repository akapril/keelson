// commands/fs.rs — 通用文本文件写入命令（供导出「另存为」使用）。
// 前端用 dialog 插件的 save() 取得目标路径后，调用此命令把内容写入磁盘。
use std::fs;
use std::path::Path;

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
