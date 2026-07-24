/// clean.rs — 日志轮转与清理模块
///
/// 提供三类清理操作：
/// 1. 移除已退出的进程记录
/// 2. 删除过期的日志文件
/// 3. 清理 SQLite 中的旧日志记录

use serde::Serialize;

use super::store;

/// 清理结果结构体
#[derive(Debug, Serialize)]
pub struct CleanResult {
    pub processes_removed: usize,
    pub log_files_deleted: usize,
    pub bytes_freed: u64,
    pub sqlite_rows_deleted: usize,
    pub retention_days: u32,
}

/// 执行清理并返回结构化结果（供 daemon 和自动清理使用）
pub fn execute(days: u32) -> CleanResult {
    let processes_removed = clean_exited_processes();
    let (log_files_deleted, bytes_freed) = clean_old_log_files(days);
    let sqlite_rows_deleted = clean_sqlite_logs(days);

    CleanResult {
        processes_removed,
        log_files_deleted,
        bytes_freed,
        sqlite_rows_deleted,
        retention_days: days,
    }
}

/// 执行清理并打印输出（供 CLI 直接调用）
pub fn run(days: u32, json_output: bool) {
    let result = execute(days);

    if json_output {
        // JSON 格式输出
        println!("{}", serde_json::to_string_pretty(&result).unwrap_or_default());
    } else {
        // 人类可读格式输出
        println!("claude-runtime clean — 日志清理\n");

        println!(
            "✓ 已清理 {} 个已退出的进程记录",
            result.processes_removed
        );

        let size_str = format_bytes(result.bytes_freed);
        println!(
            "✓ 已删除 {} 个日志文件（释放 {}）",
            result.log_files_deleted, size_str
        );

        println!(
            "✓ 已清理 SQLite 日志 {} 条记录",
            format_number(result.sqlite_rows_deleted)
        );

        println!("\n保留策略: 最近 {} 天", result.retention_days);
    }
}

// ─────────────────────────── 内部清理函数 ────────────────────────────

/// 移除状态为 "exited" 或 "stopped" 的进程记录
fn clean_exited_processes() -> usize {
    let all = store::load_processes();
    let total_before = all.len();

    // 只保留非退出状态的进程
    let active: Vec<_> = all
        .into_iter()
        .filter(|e| e.status != "exited" && e.status != "stopped")
        .collect();

    let removed = total_before - active.len();
    if removed > 0 {
        store::save_processes(&active);
    }
    removed
}

/// 删除超过指定天数的日志文件，返回 (删除文件数, 释放字节数)
fn clean_old_log_files(days: u32) -> (usize, u64) {
    let stdout_dir = store::stdout_dir();
    let mut deleted_count = 0usize;
    let mut freed_bytes = 0u64;

    // 计算过期时间阈值
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(days as u64 * 86400))
        .unwrap_or(std::time::UNIX_EPOCH);

    let read_dir = match std::fs::read_dir(&stdout_dir) {
        Ok(rd) => rd,
        Err(_) => return (0, 0), // 目录不存在或无法访问
    };

    for entry in read_dir.flatten() {
        let path = entry.path();

        // 只处理 .log 文件
        if path.extension().and_then(|e| e.to_str()) != Some("log") {
            continue;
        }

        // 获取修改时间
        let modified = match std::fs::metadata(&path).and_then(|m| m.modified()) {
            Ok(t) => t,
            Err(_) => continue,
        };

        // 如果修改时间早于截止时间，则删除
        if modified < cutoff {
            let file_size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            if std::fs::remove_file(&path).is_ok() {
                deleted_count += 1;
                freed_bytes += file_size;
            }
        }
    }

    (deleted_count, freed_bytes)
}

/// 删除 SQLite 中超过指定天数的日志记录，返回删除行数
fn clean_sqlite_logs(days: u32) -> usize {
    // 尝试打开数据库（不存在时直接返回 0）
    let db_path = store::runtime_dir().join("logs.db");
    if !db_path.exists() {
        return 0;
    }

    let conn = match std::panic::catch_unwind(|| store::init_log_db()) {
        Ok(c) => c,
        Err(_) => return 0,
    };

    // 删除过期记录
    let rows_deleted = conn
        .execute(
            &format!(
                "DELETE FROM logs WHERE timestamp < datetime('now', '-{} days')",
                days
            ),
            [],
        )
        .unwrap_or(0);

    // 回收磁盘空间
    let _ = conn.execute_batch("VACUUM");

    rows_deleted
}

// ─────────────────────────── 格式化工具 ────────────────────────────

/// 将字节数格式化为可读字符串（如 "12.3 MB"）
fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

/// 将数字格式化为带千位分隔符的字符串（如 "1,234"）
fn format_number(n: usize) -> String {
    let s = n.to_string();
    let mut result = String::new();
    let chars: Vec<char> = s.chars().collect();
    let len = chars.len();
    for (i, c) in chars.iter().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            result.push(',');
        }
        result.push(*c);
    }
    result
}
