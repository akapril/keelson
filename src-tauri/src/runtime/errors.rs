/// errors.rs — 进程崩溃错误摘要分析模块
///
/// 分析进程日志文件，提取错误行和 stack trace，生成结构化摘要。
use super::parser;
use super::store;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

/// 端口冲突信息
#[derive(Debug, Serialize, Deserialize)]
pub struct PortConflict {
    /// 冲突端口号
    pub port: u16,
    /// 占用该端口的进程 PID（若可检测到）
    pub occupied_by_pid: Option<u32>,
    /// 占用该端口的进程名称（若可检测到）
    pub occupied_by_name: Option<String>,
}

/// 错误摘要结构体
#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorSummary {
    /// 进程名称
    pub name: String,
    /// 进程状态
    pub status: String,
    /// 退出相关的错误行（最多 20 条）
    pub errors: Vec<String>,
    /// 最后 30 行日志（上下文）
    pub last_lines: Vec<String>,
    /// 检测到的 stack trace（如果有）
    pub stack_trace: Option<String>,
    /// 重启次数
    pub restart_count: u32,
    /// 端口冲突信息（若检测到 EADDRINUSE 类错误）
    pub port_conflict: Option<PortConflict>,
}

// ─────────────────────────── 端口冲突检测 ────────────────────────────

/// 匹配 EADDRINUSE / address already in use 类错误的正则，同时尝试捕获端口号
/// 例如：
///   listen EADDRINUSE: address already in use 0.0.0.0:3000
///   port 8080 is already in use
///   bind: address already in use
static PORT_CONFLICT_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(?:EADDRINUSE|address already in use|port \d+ is already in use|bind.*address already in use)",
    )
    .unwrap()
});

/// 从冲突错误行中提取端口号（如 ":3000" 或 "port 3000"）
static PORT_NUMBER_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:port\s+(\d{2,5})|:(\d{2,5})\b)").unwrap()
});

/// 检测日志内容中的端口冲突，返回 PortConflict（若有）
pub fn detect_port_conflict(log_content: &str) -> Option<PortConflict> {
    // 在所有行中寻找端口冲突错误
    for line in log_content.lines() {
        if !PORT_CONFLICT_PATTERN.is_match(line) {
            continue;
        }

        // 从该行提取端口号
        let port = PORT_NUMBER_PATTERN.captures(line).and_then(|caps| {
            caps.get(1)
                .or_else(|| caps.get(2))
                .and_then(|m| m.as_str().parse::<u16>().ok())
        });

        if let Some(port_num) = port {
            let (pid, name) = find_port_occupier(port_num);
            return Some(PortConflict {
                port: port_num,
                occupied_by_pid: pid,
                occupied_by_name: name,
            });
        }
    }
    None
}

/// 查找占用指定端口的进程 PID 和进程名
fn find_port_occupier(port: u16) -> (Option<u32>, Option<String>) {
    #[cfg(windows)]
    {
        find_port_occupier_windows(port)
    }
    #[cfg(target_os = "linux")]
    {
        find_port_occupier_linux(port)
    }
    #[cfg(target_os = "macos")]
    {
        find_port_occupier_macos(port)
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = port;
        (None, None)
    }
}

/// Windows：使用 netstat -ano 查找监听指定端口的 PID，再用 tasklist 获取进程名
#[cfg(windows)]
fn find_port_occupier_windows(port: u16) -> (Option<u32>, Option<String>) {
    use std::process::Command;

    // 构建端口匹配字符串，如 ":3000 "（末尾空格避免匹配 :30001 等）
    let port_suffix = format!(":{} ", port);

    let output = match Command::new("netstat").args(["-ano"]).output() {
        Ok(o) => o,
        Err(_) => return (None, None),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut found_pid: Option<u32> = None;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("TCP") {
            continue;
        }
        if !trimmed.contains("LISTENING") {
            continue;
        }
        // 第二列为本地地址，检查是否包含目标端口
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }
        let local_addr = parts[1];
        // 本地地址需要以 ":PORT" 结尾（或 ":PORT " 在整行中）
        if !local_addr.ends_with(&format!(":{}", port)) {
            // 也尝试整行匹配（netstat 格式中本地地址后跟空格）
            if !trimmed.contains(&port_suffix) {
                continue;
            }
        }

        // 最后一列为 PID
        if let Ok(pid) = parts[parts.len() - 1].parse::<u32>() {
            found_pid = Some(pid);
            break;
        }
    }

    let pid = match found_pid {
        Some(p) => p,
        None => return (None, None),
    };

    // 通过 tasklist 获取进程名
    let tl_output = match Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/NH", "/FO", "CSV"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return (Some(pid), None),
    };

    let tl_stdout = String::from_utf8_lossy(&tl_output.stdout);
    // CSV 格式第一行第一列为进程名（带引号），如 "node.exe","12345",...
    let process_name = tl_stdout
        .lines()
        .next()
        .and_then(|line| {
            // 去除引号后取第一个逗号分隔字段
            let line = line.trim().trim_matches('"');
            line.split('"').next().map(|s| s.trim_matches(',').trim_matches('"').to_string())
        })
        .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("no tasks") && !s.starts_with("INFO:"));

    (Some(pid), process_name)
}

/// Linux：使用 ss -tlnp 查找监听指定端口的进程信息
#[cfg(target_os = "linux")]
fn find_port_occupier_linux(port: u16) -> (Option<u32>, Option<String>) {
    use std::process::Command;

    let output = match Command::new("ss").args(["-tlnp"]).output() {
        Ok(o) => o,
        Err(_) => return (None, None),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let port_suffix = format!(":{}", port);

    for line in stdout.lines() {
        // 格式: State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }
        // 第四列（索引3）是本地地址
        if !parts[3].ends_with(&port_suffix) {
            continue;
        }
        // 最后一列包含进程信息，格式: users:(("name",pid=1234,fd=5))
        let process_part = parts[parts.len() - 1];
        let pid = Regex::new(r"pid=(\d+)")
            .ok()
            .and_then(|re| re.captures(process_part))
            .and_then(|caps| caps.get(1))
            .and_then(|m| m.as_str().parse::<u32>().ok());

        let name = Regex::new(r#"\(\("([^"]+)""#)
            .ok()
            .and_then(|re| re.captures(process_part))
            .and_then(|caps| caps.get(1))
            .map(|m| m.as_str().to_string());

        return (pid, name);
    }

    (None, None)
}

/// macOS：使用 lsof 查找监听指定端口的进程信息
#[cfg(target_os = "macos")]
fn find_port_occupier_macos(port: u16) -> (Option<u32>, Option<String>) {
    use std::process::Command;

    let output = match Command::new("lsof")
        .args(["-iTCP", &format!(":{}", port), "-sTCP:LISTEN", "-P", "-n"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return (None, None),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut first_line = true;

    for line in stdout.lines() {
        if first_line {
            first_line = false;
            continue; // 跳过标题行
        }
        // 格式: COMMAND PID USER ...
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let name = parts[0].to_string();
        let pid = parts[1].parse::<u32>().ok();
        return (pid, Some(name));
    }

    (None, None)
}

/// 分析进程的错误日志，生成摘要
pub fn analyze(name_or_id: &str) -> Result<ErrorSummary, String> {
    let entry = store::find_process(name_or_id)
        .ok_or_else(|| format!("找不到进程 '{}'", name_or_id))?;

    // 读取日志文件
    let log_path = store::stdout_dir().join(format!("{}.log", entry.id));
    let content = std::fs::read(&log_path)
        .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
        .unwrap_or_default();

    let all_lines: Vec<&str> = content.lines().collect();

    // 提取最后 30 行作为上下文
    let tail_start = if all_lines.len() > 30 {
        all_lines.len() - 30
    } else {
        0
    };
    let last_lines: Vec<String> = all_lines[tail_start..]
        .iter()
        .map(|s| s.to_string())
        .collect();

    // 提取所有 error 级别的行
    let mut errors: Vec<String> = Vec::new();
    for line in &all_lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed = parser::parse_line(trimmed);
        if parsed.level.as_deref() == Some("error") {
            errors.push(trimmed.to_string());
        }
    }
    // 只保留最后 20 条错误
    if errors.len() > 20 {
        errors = errors[errors.len() - 20..].to_vec();
    }

    // 检测 stack trace
    let stack_trace = extract_stack_trace(&all_lines);

    // 检测端口冲突
    let port_conflict = detect_port_conflict(&content);

    Ok(ErrorSummary {
        name: entry.name,
        status: entry.status,
        errors,
        last_lines,
        stack_trace,
        restart_count: entry.restart_count,
        port_conflict,
    })
}

/// 从日志行中提取 stack trace
///
/// 支持以下模式：
/// - Python Traceback
/// - Rust/Go panic
/// - Node.js/Java Error + "at " 行
/// - Rust 编译错误（--> 和 note: 行）
fn extract_stack_trace(lines: &[&str]) -> Option<String> {
    let mut trace_lines: Vec<&str> = Vec::new();
    let mut in_trace = false;

    for line in lines {
        let trimmed = line.trim();

        // Stack trace 起始标记
        if !in_trace {
            if trimmed.starts_with("Traceback") // Python
                || trimmed.starts_with("panic:") // Rust/Go
                || (trimmed.starts_with("Error:") && trimmed.len() > 10) // Node.js
                || (trimmed.contains("Unhandled") && trimmed.contains("exception")) // Java
                || trimmed.contains("FATAL")
                || (trimmed.starts_with("thread '") && trimmed.contains("panicked")) // Rust
            {
                in_trace = true;
                trace_lines.clear();
                trace_lines.push(trimmed);
                continue;
            }
        }

        if in_trace {
            // Stack trace 行的特征
            if trimmed.starts_with("at ") // Node.js/Java
                || trimmed.starts_with("File \"") // Python
                || trimmed.starts_with("  ") // 缩进行（Python/Rust）
                || trimmed.starts_with('\t') // Tab 缩进行
                || trimmed.contains("    at ") // Node.js 嵌套
                || trimmed.starts_with("Caused by") // Java
                || trimmed.starts_with("note:") // Rust 编译器
                || trimmed.starts_with("-->") // Rust 编译器源码位置
            {
                trace_lines.push(trimmed);
            } else if !trimmed.is_empty() {
                // 遇到非 trace 行，追加最后一行后结束
                trace_lines.push(trimmed);
                in_trace = false;
            }
        }
    }

    if trace_lines.len() >= 2 {
        Some(trace_lines.join("\n"))
    } else {
        None
    }
}
