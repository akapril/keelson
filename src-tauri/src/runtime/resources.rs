/// resources.rs — 进程资源使用量采集模块
///
/// 通过系统命令获取指定 PID 的 CPU 使用率和内存占用，
/// 不引入任何额外 crate 依赖，纯系统命令实现。

use serde::Serialize;

// ─────────────────────────── 数据结构 ────────────────────────────

#[derive(Debug, Clone, Serialize, Default)]
pub struct ResourceUsage {
    /// 内存使用量（字节）
    pub memory_bytes: u64,
    /// 内存使用量（人类可读，如 "12.3 MB"）
    pub memory_display: String,
    /// CPU 使用率百分比（近似值，Windows 上为 0.0）
    pub cpu_percent: f32,
}

// ─────────────────────────── 公共接口 ────────────────────────────

/// 获取指定 PID 的资源使用情况（实时采集，不缓存）
pub fn get_usage(pid: u32) -> ResourceUsage {
    #[cfg(windows)]
    {
        get_usage_windows(pid)
    }
    #[cfg(unix)]
    {
        get_usage_unix(pid)
    }
}

// ─────────────────────────── Windows 实现 ────────────────────────────

/// Windows 下通过 tasklist /FO CSV 解析内存使用量
/// 输出示例：`"cmd.exe","1234","Console","1","5,260 K"`
#[cfg(windows)]
fn get_usage_windows(pid: u32) -> ResourceUsage {
    use std::process::Command;

    // tasklist 输出的最后一列是内存（如 "5,260 K"）
    let output = Command::new("tasklist")
        .args([
            "/FI",
            &format!("PID eq {}", pid),
            "/FO",
            "CSV",
            "/NH",
        ])
        .output();

    let mut memory_bytes: u64 = 0;

    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            // CSV 格式：每个字段被双引号包围，用逗号分隔
            // 典型行："cmd.exe","1234","Console","1","5,260 K"
            let fields: Vec<&str> = line.split(',').collect();
            if fields.len() >= 5 {
                // 最后一个字段是内存，去掉双引号和 " K" 后缀，去掉数字中的逗号分隔符
                // 注意：Windows 区域设置可能用逗号作千位分隔符（如 "5,260 K"），
                // 也可能是字段分隔符，需合并最后若干字段
                // 取最后一个字段（含结尾的双引号），格式为 `"N,NNN K"`
                let last = fields[fields.len() - 1].trim().trim_matches('"');
                // 去掉 " K" 后缀
                let num_str = last
                    .trim_end_matches(" K")
                    .trim_end_matches(" k")
                    .replace(',', ""); // 去掉千位分隔符逗号
                if let Ok(kb) = num_str.trim().parse::<u64>() {
                    memory_bytes = kb * 1024;
                    break;
                }
            }
        }
    }

    ResourceUsage {
        memory_bytes,
        memory_display: format_bytes(memory_bytes),
        cpu_percent: 0.0, // Windows 瞬时 CPU% 需两次采样，此处跳过
    }
}

// ─────────────────────────── Unix 实现 ────────────────────────────

/// Unix 下通过 `ps -p {pid} -o %cpu,rss --no-headers` 获取资源
/// 输出示例：`  0.5 12456`（%cpu 和 RSS(KB)）
#[cfg(unix)]
fn get_usage_unix(pid: u32) -> ResourceUsage {
    use std::process::Command;

    let output = Command::new("ps")
        .args([
            "-p",
            &pid.to_string(),
            "-o",
            "%cpu,rss",
            "--no-headers",
        ])
        .output();

    let mut cpu_percent: f32 = 0.0;
    let mut memory_bytes: u64 = 0;

    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        let line = text.trim();
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            cpu_percent = parts[0].parse().unwrap_or(0.0);
            // RSS 单位为 KB
            let rss_kb: u64 = parts[1].parse().unwrap_or(0);
            memory_bytes = rss_kb * 1024;
        }
    }

    ResourceUsage {
        memory_bytes,
        memory_display: format_bytes(memory_bytes),
        cpu_percent,
    }
}

// ─────────────────────────── 格式化辅助 ────────────────────────────

/// 将字节数转换为人类可读的字符串
fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "—".to_string();
    }
    if bytes >= 1_073_741_824 {
        format!("{:.1} GB", bytes as f64 / 1_073_741_824.0)
    } else if bytes >= 1_048_576 {
        format!("{:.1} MB", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1024 {
        format!("{:.0} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}
