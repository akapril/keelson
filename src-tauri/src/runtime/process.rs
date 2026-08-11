// runtime/process.rs —— 进程判活工具。
// 注：去 TCP 重构后，start/stop/restart/ps 已由 daemon.rs 的 async handle_* 取代
//（返回 JSON、不 process::exit），本文件只保留仍被 daemon 复用的判活函数。
// 判活/存活集统一委托 super::sysmon（sysinfo）：跨平台一套代码，无子进程、无 tasklist/ps 文本解析。
use std::collections::HashSet;

use super::store::{self, ProcessEntry};

/// 检查指定 PID 是否存活（委托 sysinfo 全局监控）。
pub fn is_pid_alive(pid: u32) -> bool {
    super::sysmon::is_alive(pid)
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
/// sysinfo 一次刷新枚举全表得存活集，O(1) 集合查批量判活；交互进程 pid=0 由 should_mark_exited 跳过。
pub fn sync_process_status() {
    let entries = store::load_processes();
    let running: Vec<&ProcessEntry> = entries.iter().filter(|e| e.status == "running").collect();
    if running.is_empty() {
        return;
    }
    let alive = super::sysmon::alive_pids();
    for entry in running {
        if should_mark_exited(entry, &alive) {
            store::update_process(&entry.id, |e| {
                e.status = "exited".to_string();
            });
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
            label: None,
            note: None,
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
