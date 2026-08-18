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

/// 获取指定 PID 的资源使用情况（委托 sysinfo 全局监控，跨平台一套实现）。
/// 内存为 RSS 字节；CPU% 基于两次刷新差值——进程首次被采样时通常为 0，后续轮询才是真实值
///（这也顺带补上了原 tasklist 方案在 Windows 上恒为 0 的 CPU%）。
pub fn get_usage(pid: u32) -> ResourceUsage {
    let (memory_bytes, cpu_percent) = super::sysmon::usage(pid);
    ResourceUsage {
        memory_bytes,
        memory_display: format_bytes(memory_bytes),
        cpu_percent,
    }
}

// ─────────────────────────── 格式化辅助 ────────────────────────────

/// 将字节数转换为人类可读的字符串（供 runtime_status 命令复用）
pub(crate) fn format_bytes(bytes: u64) -> String {
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
