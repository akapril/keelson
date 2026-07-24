use std::io::Read;
use std::path::PathBuf;

use super::store;

/// 启动后台日志捕获线程（保留接口兼容性，但不再写入 SQLite）
/// 注意：由于 CLI 进程是短暂的，此线程会在父进程退出时终止。
/// 实际日志读取通过直接解析日志文件实现。
pub fn start_capture(_process_id: String, _log_file_path: PathBuf) {
    // 不再使用后台线程写入 SQLite，因为 CLI 进程短暂存在
    // 日志查询直接从日志文件读取
}

/// 日志行结构
struct LogLine {
    line_num: usize,
    raw: String,
}

/// 从日志文件中读取所有行（支持非 UTF-8 编码，使用 lossy 转换）
fn read_log_file(log_path: &PathBuf) -> Vec<LogLine> {
    let mut file = match std::fs::File::open(log_path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };

    // 读取全部字节内容
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return Vec::new();
    }

    // 使用 lossy 转换处理非 UTF-8 编码（如 Windows GBK）
    let content = String::from_utf8_lossy(&bytes);

    // 按行分割，收集非空行
    let mut lines = Vec::new();
    let mut num = 0usize;
    for raw_line in content.lines() {
        let trimmed = raw_line.trim();
        if !trimmed.is_empty() {
            lines.push(LogLine {
                line_num: num,
                raw: trimmed.to_string(),
            });
            num += 1;
        }
    }

    lines
}

/// 查询进程日志，支持级别、时间范围、关键词过滤
pub fn query(
    name_or_id: &str,
    level: Option<&str>,
    _since: Option<&str>,
    grep: Option<&str>,
    limit: usize,
    json_output: bool,
) {
    // 查找进程
    let entry = match store::find_process(name_or_id) {
        Some(e) => e,
        None => {
            eprintln!("错误：找不到进程 '{}'", name_or_id);
            std::process::exit(1);
        }
    };

    // 构建日志文件路径（规则：~/.claude-runtime/stdout/{id}.log）
    let log_path = store::stdout_dir().join(format!("{}.log", entry.id));

    // 读取日志文件所有行
    let all_lines = read_log_file(&log_path);

    if all_lines.is_empty() {
        if json_output {
            println!("[]");
        } else {
            println!("（没有匹配的日志记录）");
        }
        return;
    }

    // 应用关键词过滤
    let filtered: Vec<&LogLine> = all_lines
        .iter()
        .filter(|l| {
            if let Some(pattern) = grep {
                l.raw.contains(pattern)
            } else {
                true
            }
        })
        .collect();

    // 应用级别过滤（基于简单解析）
    let filtered: Vec<&LogLine> = filtered
        .into_iter()
        .filter(|l| {
            if let Some(lvl) = level {
                let parsed = super::parser::parse_line(&l.raw);
                parsed.level.as_deref().map(|pl| pl.eq_ignore_ascii_case(lvl)).unwrap_or(false)
            } else {
                true
            }
        })
        .collect();

    // 取最后 limit 行（保留正序）
    let start_idx = if filtered.len() > limit {
        filtered.len() - limit
    } else {
        0
    };
    let result = &filtered[start_idx..];

    if json_output {
        // 输出 JSON 数组
        let json_rows: Vec<serde_json::Value> = result
            .iter()
            .map(|l| {
                let parsed = super::parser::parse_line(&l.raw);
                serde_json::json!({
                    "line": l.line_num,
                    "level": parsed.level,
                    "raw": l.raw,
                })
            })
            .collect();
        println!("{}", serde_json::to_string_pretty(&json_rows).unwrap_or_default());
    } else {
        if result.is_empty() {
            println!("（没有匹配的日志记录）");
            return;
        }
        for l in result {
            let parsed = super::parser::parse_line(&l.raw);
            let level_display = parsed.level.as_deref().unwrap_or("info").to_uppercase();
            println!("[{}] {}", level_display, l.raw);
        }
    }
}
