//! 目录占用统计：递归求字节数（供运行时磁盘占用展示）。不跟随符号链接。
use std::path::Path;

/// 递归求目录字节数。不可读的项跳过；不跟随符号链接（防循环）；路径不存在返回 0。
pub fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let entries = match std::fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    for entry in entries.flatten() {
        // symlink_metadata 不跟随符号链接，避免符号链接指向大目录/成环
        // 注：DirEntry::metadata() 在 Windows 上已不跟随符号链接，
        // 但为跨平台一致性，显式使用 fs::symlink_metadata(&path) 语义更明确
        let meta = match std::fs::symlink_metadata(entry.path()) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            continue; // 跳过符号链接
        }
        if meta.is_dir() {
            total = total.saturating_add(dir_size(&entry.path()));
        } else if meta.is_file() {
            total = total.saturating_add(meta.len());
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nonexistent_path_is_zero() {
        assert_eq!(dir_size(Path::new("/keelson_no_such_dir_xyz_123")), 0);
    }

    #[test]
    fn sums_file_sizes() {
        // 建临时目录写两个文件，验证求和
        let dir = std::env::temp_dir().join(format!("keelson_disk_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), vec![0u8; 100]).unwrap();
        std::fs::write(dir.join("b.txt"), vec![0u8; 50]).unwrap();
        let sz = dir_size(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(sz, 150);
    }
}
