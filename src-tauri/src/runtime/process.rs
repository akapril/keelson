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

/// 判定某个 running 进程是否应被标记为 exited。
///
/// 交互式 PTY 进程（interactive=true）pid=0，生命周期由 InteractivePtyRegistry
/// 的 reader 线程管理（退出时自己 emit + 标 exited），PID 判活对其不适用，
/// 一律跳过，避免误标为 exited。
/// 普通进程：若 pid 不在存活集中则应标 exited。
pub fn should_mark_exited(entry: &ProcessEntry, alive: &HashSet<u32>) -> bool {
    // 交互进程由 PTY reader 线程自管生命周期，跳过 PID 判活
    if entry.interactive {
        return false;
    }
    !alive.contains(&entry.pid)
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
        // 快照可用：O(1) 集合查，一次子进程搞定全部；交互进程由 should_mark_exited 跳过
        Some(alive) => {
            for entry in running {
                if should_mark_exited(entry, &alive) {
                    store::update_process(&entry.id, |e| {
                        e.status = "exited".to_string();
                    });
                }
            }
        }
        // 取快照失败：回退逐个判活（保持正确性）；交互进程 pid=0 跳过（PID kill 无效）
        None => {
            for entry in running {
                // 交互进程生命周期由 PTY reader 线程管理，跳过 PID 判活
                if entry.interactive {
                    continue;
                }
                if !is_pid_alive(entry.pid) {
                    store::update_process(&entry.id, |e| {
                        e.status = "exited".to_string();
                    });
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    /// 构造一个最小 "running" 状态的普通（非交互）进程条目，供测试复用
    fn sample_running_entry() -> ProcessEntry {
        ProcessEntry {
            id: "test01".to_string(),
            name: "test-proc".to_string(),
            command: "echo hello".to_string(),
            cwd: "/tmp".to_string(),
            pid: 1234,
            port: Vec::new(),
            status: "running".to_string(),
            started_at: Utc::now(),
            max_restarts: 0,
            restart_count: 0,
            health_url: None,
            health: "unknown".to_string(),
            env: std::collections::HashMap::new(),
            session_id: None,
            provider: None,
            interactive: false,
        }
    }

    /// 交互进程（interactive=true，pid=0）在空存活集中不应被标记为 exited；
    /// 普通进程 pid 不在存活集时应被标记 exited。
    #[test]
    fn sync_skips_interactive_processes() {
        let alive: HashSet<u32> = HashSet::new(); // 空存活集，所有普通进程均"死"

        // 1. 交互进程：pid=0，interactive=true → 不误标 exited
        let mut e = sample_running_entry();
        e.pid = 0;
        e.interactive = true;
        assert!(!should_mark_exited(&e, &alive), "交互进程不应被标为 exited");

        // 2. 普通进程：pid 不在存活集 → 应标 exited
        e.interactive = false;
        e.pid = 4321;
        assert!(should_mark_exited(&e, &alive), "不在存活集的普通进程应被标为 exited");
    }

    /// 普通进程 pid 在存活集中 → 不标 exited
    #[test]
    fn does_not_mark_alive_process_as_exited() {
        let mut alive: HashSet<u32> = HashSet::new();
        alive.insert(9999);
        let mut e = sample_running_entry();
        e.pid = 9999;
        e.interactive = false;
        assert!(!should_mark_exited(&e, &alive), "存活集中的进程不应被标为 exited");
    }
}
