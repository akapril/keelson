// runtime/process.rs —— 进程判活工具。
// 注：去 TCP 重构后，start/stop/restart/ps 已由 daemon.rs 的 async handle_* 取代
//（返回 JSON、不 process::exit），本文件只保留仍被 daemon 复用的判活函数。
use std::collections::HashSet;
use std::process::Command;

use super::store::{self, ProcessEntry};

/// 检查指定 PID 是否存活
pub fn is_pid_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        // 使用 tasklist 查询指定 PID 是否存在
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid), "/NH"])
            .output();
        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                stdout.contains(&pid.to_string())
            }
            Err(_) => false,
        }
    }
    #[cfg(unix)]
    {
        // Unix: 发送信号 0 检测进程是否存活（kill -0 不会终止进程）
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

/// 一次性取当前所有存活进程的 PID 集合（Windows 单次 tasklist / Unix 单次 ps）。
/// 避免对每个受管进程各 spawn 一个子进程——21 个进程=21 次 tasklist，耗时近 1s，
/// 是「进程」tab 每 4s 卡顿的元凶。取不到快照返回 None（调用方回退逐个判活）。
fn alive_pid_set() -> Option<HashSet<u32>> {
    #[cfg(windows)]
    let output = Command::new("tasklist").args(["/FO", "CSV", "/NH"]).output();
    #[cfg(unix)]
    let output = Command::new("ps").args(["-A", "-o", "pid="]).output();

    let out = output.ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut set = HashSet::new();
    #[cfg(windows)]
    {
        // CSV 行形如 "name","pid","session","session#","memusage"，取第 2 字段
        for line in text.lines() {
            let fields: Vec<&str> = line.split("\",\"").collect();
            if fields.len() >= 2 {
                if let Ok(pid) = fields[1].trim_matches('"').trim().parse::<u32>() {
                    set.insert(pid);
                }
            }
        }
    }
    #[cfg(unix)]
    {
        for line in text.lines() {
            if let Ok(pid) = line.trim().parse::<u32>() {
                set.insert(pid);
            }
        }
    }
    Some(set)
}

/// 同步所有进程状态：将 PID 已死的 "running" 进程标记为 "exited"。
/// 用一次进程快照批量判活（而非每个 PID 各 spawn 一次 tasklist）。
pub fn sync_process_status() {
    let entries = store::load_processes();
    let running: Vec<&ProcessEntry> = entries.iter().filter(|e| e.status == "running").collect();
    if running.is_empty() {
        return;
    }
    match alive_pid_set() {
        // 快照可用：O(1) 集合查，一次子进程搞定全部
        Some(alive) => {
            for entry in running {
                if !alive.contains(&entry.pid) {
                    store::update_process(&entry.id, |e| {
                        e.status = "exited".to_string();
                    });
                }
            }
        }
        // 取快照失败：回退逐个判活（保持正确性）
        None => {
            for entry in running {
                if !is_pid_alive(entry.pid) {
                    store::update_process(&entry.id, |e| {
                        e.status = "exited".to_string();
                    });
                }
            }
        }
    }
}
