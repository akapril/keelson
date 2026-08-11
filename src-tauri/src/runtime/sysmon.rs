//! 系统进程监控（sysinfo）：跨平台统一的判活 / 内存 / CPU / 进程名，
//! 取代原先按 OS 分派的 tasklist/ps 命令 + 各自文本解析。
//!
//! 用一个**全局复用**的 System 实例：CPU% 由"两次刷新的时间差"算出，必须跨轮询复用同一
//! System（每次新建都从 0 起，永远拿不到有效 CPU%）。parking_lot::Mutex 串行化并发访问。
//! 收益：无子进程 → 从根上消除 Windows 控制台黑窗；无 PATH 依赖；无 locale 相关解析；一套
//! 代码覆盖 Windows/macOS/Linux（sysinfo 各 OS 后端条件编译，纯 Rust，无需 libclang）。

use std::collections::HashSet;
use std::sync::OnceLock;

use parking_lot::Mutex;
use sysinfo::{Pid, ProcessesToUpdate, System};

/// 全局 System：跨轮询复用（CPU% 依赖两次刷新的差值，故不能每次新建）。
fn sys() -> &'static Mutex<System> {
    static SYS: OnceLock<Mutex<System>> = OnceLock::new();
    SYS.get_or_init(|| Mutex::new(System::new()))
}

/// 全部存活进程的 PID 集合（一次刷新枚举全表，remove_dead=true 顺带清理已退出条目）。
pub fn alive_pids() -> HashSet<u32> {
    let mut s = sys().lock();
    s.refresh_processes(ProcessesToUpdate::All, true);
    s.processes().keys().map(|pid| pid.as_u32()).collect()
}

/// 指定 PID 是否存活。
pub fn is_alive(pid: u32) -> bool {
    let mut s = sys().lock();
    let p = Pid::from_u32(pid);
    s.refresh_processes(ProcessesToUpdate::Some(&[p]), false);
    s.process(p).is_some()
}

/// 指定 PID 的资源占用：`(内存字节, CPU%)`。
/// CPU% 基于两次刷新的差值，**首次调用通常为 0**，后续轮询才准（sysinfo 语义）。
pub fn usage(pid: u32) -> (u64, f32) {
    let mut s = sys().lock();
    let p = Pid::from_u32(pid);
    s.refresh_processes(ProcessesToUpdate::Some(&[p]), false);
    match s.process(p) {
        Some(process) => (process.memory(), process.cpu_usage()),
        None => (0, 0.0),
    }
}

/// 指定 PID 的进程名（找不到返回 None）。供端口占用诊断展示占用者名称。
pub fn process_name(pid: u32) -> Option<String> {
    let mut s = sys().lock();
    let p = Pid::from_u32(pid);
    s.refresh_processes(ProcessesToUpdate::Some(&[p]), false);
    s.process(p).map(|process| process.name().to_string_lossy().into_owned())
}
