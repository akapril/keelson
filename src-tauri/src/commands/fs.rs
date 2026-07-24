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
    // 防写入已知敏感文件（WebView XSS/注入企图持久化后门）
    let fname = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
    const BLOCKED: &[&str] = &[
        ".bashrc", ".zshrc", ".bash_profile", ".profile",
        "id_rsa", "id_ed25519", "authorized_keys", "known_hosts",
        "settings.json", "hosts",
    ];
    if BLOCKED.iter().any(|b| fname.eq_ignore_ascii_case(b)) {
        return Err(format!("拒绝写入敏感文件: {fname}"));
    }
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
    // 仅允许读 .md / .json（当前用途：导入计划 .md、Taskmaster tasks.json）。
    // 防任意文件读取（如 ~/.ssh/id_rsa、.env）。
    let ext = Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());
    if !matches!(ext.as_deref(), Some("md") | Some("json")) {
        return Err("仅支持读取 .md / .json 文件".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {e}"))
}

/// 递归收集 .md 文件的最大深度（superpowers 计划常放 plans/<feature>/ 子目录）。
const MD_MAX_DEPTH: usize = 6;

/// 递归收集目录下的 .md（跳过隐藏目录与 node_modules/target/.git 等重目录）。
fn collect_md(dir: &Path, depth: usize, out: &mut Vec<MdFile>) {
    if depth > MD_MAX_DEPTH {
        return;
    }
    let rd = match fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if name.starts_with('.') || matches!(name, "node_modules" | "target") {
                continue;
            }
            collect_md(&p, depth + 1, out);
        } else if p.extension().and_then(|s| s.to_str()) == Some("md") {
            if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                out.push(MdFile {
                    name: name.to_string(),
                    path: p.to_string_lossy().into_owned(),
                });
            }
        }
    }
}

/// 递归列目录下的 .md 文件（按路径排序）。目录不存在 → 空列表（非错误，便于前端空态）。
/// 递归：计划常在 plans/<feature>/ 子目录，非递归会漏。name 仍为文件名（供 spec 按名匹配）。
#[tauri::command]
pub fn list_markdown_files(dir: String) -> Result<Vec<MdFile>, String> {
    let d = Path::new(&dir);
    if !d.is_dir() {
        return Ok(vec![]);
    }
    let mut out: Vec<MdFile> = vec![];
    collect_md(d, 0, &mut out);
    out.sort_by(|a, b| a.path.cmp(&b.path));
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

    #[test]
    fn read_rejects_non_md() {
        // 非 .md 一律拒绝（防任意文件读取）
        assert!(read_text_file("C:/Windows/System32/drivers/etc/hosts".into()).is_err());
        assert!(read_text_file("Z:/secret.txt".into()).is_err());
    }

    #[test]
    fn write_rejects_sensitive() {
        // 敏感文件名一律拒绝写入
        assert!(write_text_file("Z:/tmp/.bashrc".into(), "x".into()).is_err());
        assert!(write_text_file("Z:/home/user/id_rsa".into(), "x".into()).is_err());
    }

    #[test]
    fn list_markdown_recurses_subdirs_and_skips_heavy() {
        // 临时目录：顶层 + 子目录各放 .md，node_modules 里的应被跳过
        let base = std::env::temp_dir().join(format!("rework-md-test-{}", std::process::id()));
        let sub = base.join("feature");
        let heavy = base.join("node_modules");
        fs::create_dir_all(&sub).unwrap();
        fs::create_dir_all(&heavy).unwrap();
        fs::write(base.join("top.md"), "x").unwrap();
        fs::write(sub.join("nested.md"), "x").unwrap();
        fs::write(heavy.join("dep.md"), "x").unwrap();

        let out = list_markdown_files(base.to_string_lossy().into_owned()).unwrap();
        let names: Vec<&str> = out.iter().map(|m| m.name.as_str()).collect();
        assert!(names.contains(&"top.md"), "应含顶层");
        assert!(names.contains(&"nested.md"), "应含子目录(递归)");
        assert!(!names.contains(&"dep.md"), "应跳过 node_modules");

        let _ = fs::remove_dir_all(&base);
    }
}
