use chrono::Utc;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::process::Command;
use uuid::Uuid;

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

/// 启动一个新进程
pub fn start(
    command: &str,
    name: Option<&str>,
    cwd: Option<&str>,
    env_vars: &HashMap<String, String>,
    json_output: bool,
) {
    // 生成 6 位短 ID
    let id = Uuid::new_v4().to_string()[..6].to_string();

    // 确定进程名称，默认使用 ID
    let process_name = name.unwrap_or(&id).to_string();

    // 检查名称是否已存在
    if store::find_process(&process_name).is_some() {
        eprintln!("错误：进程名称 '{}' 已存在，请先停止该进程或使用其他名称", process_name);
        std::process::exit(1);
    }

    // 确定工作目录，默认为当前目录
    let working_dir = match cwd {
        Some(d) => d.to_string(),
        None => std::env::current_dir()
            .expect("无法获取当前目录")
            .to_string_lossy()
            .to_string(),
    };

    // 创建日志文件路径
    let log_path = store::stdout_dir().join(format!("{}.log", id));
    let log_file = fs::File::create(&log_path).expect("无法创建日志文件");

    // 克隆日志文件句柄用于 stderr
    let log_file_stderr = log_file.try_clone().expect("无法克隆日志文件句柄");

    // 根据平台选择 shell 启动方式，并确保子进程与父进程分离
    #[cfg(windows)]
    let child = {
        use std::os::windows::process::CommandExt;
        // CREATE_NEW_PROCESS_GROUP (0x00000200) 使子进程独立于父进程
        // chcp 65001 强制子进程输出 UTF-8，避免 GBK 乱码
        let utf8_command = format!("chcp 65001 >nul && {}", command);
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", &utf8_command])
            .current_dir(&working_dir)
            .stdout(log_file)
            .stderr(log_file_stderr)
            .creation_flags(0x00000200);
        // 注入环境变量
        for (key, value) in env_vars {
            cmd.env(key, value);
        }
        cmd.spawn()
    };

    #[cfg(unix)]
    let child = {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", command])
            .current_dir(&working_dir)
            .stdout(log_file)
            .stderr(log_file_stderr);
        // 注入环境变量
        for (key, value) in env_vars {
            cmd.env(key, value);
        }
        cmd.spawn()
    };

    let child = match child {
        Ok(c) => c,
        Err(e) => {
            eprintln!("错误：无法启动进程: {}", e);
            std::process::exit(1);
        }
    };

    let pid = child.id();

    // 将子进程句柄 forget，使其在父进程退出后继续运行
    std::mem::forget(child);

    // 构建进程条目并写入存储
    let entry = ProcessEntry {
        id: id.clone(),
        name: process_name.clone(),
        command: command.to_string(),
        cwd: working_dir.clone(),
        pid,
        port: Vec::new(),
        status: "running".to_string(),
        started_at: Utc::now(),
        max_restarts: 0,
        restart_count: 0,
        health_url: None,
        health: "unknown".to_string(),
        env: env_vars.clone(),
    };

    store::add_process(entry);

    // 启动后台日志捕获线程：持续读取日志文件并写入 SQLite
    super::logs::start_capture(id.clone(), log_path.clone());

    // 后台轮询端口：每隔 1 秒检测一次，最多尝试 10 次，检测到则写入存储
    {
        let id_clone = id.clone();
        let child_pid = pid; // pid 已在 forget 前捕获
        std::thread::spawn(move || {
            for _ in 0..10 {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let ports = super::port::detect_ports(child_pid);
                if !ports.is_empty() {
                    super::store::update_process(&id_clone, |e| {
                        e.port = ports;
                    });
                    break;
                }
            }
        });
    }

    // 输出结果
    if json_output {
        println!(
            "{}",
            json!({
                "id": id,
                "name": process_name,
                "pid": pid,
                "status": "running",
                "command": command,
                "cwd": working_dir,
                "log": log_path.to_string_lossy()
            })
        );
    } else {
        println!("✓ 进程已启动");
        println!("  ID      : {}", id);
        println!("  名称    : {}", process_name);
        println!("  PID     : {}", pid);
        println!("  命令    : {}", command);
        println!("  工作目录: {}", working_dir);
        println!("  日志文件: {}", log_path.display());
    }
}

/// 停止一个进程
pub fn stop(name_or_id: &str, json_output: bool) {
    let entry = match store::find_process(name_or_id) {
        Some(e) => e,
        None => {
            eprintln!("错误：找不到进程 '{}'", name_or_id);
            std::process::exit(1);
        }
    };

    // 执行平台对应的 kill 操作
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &entry.pid.to_string(), "/T", "/F"])
            .output();
    }

    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &entry.pid.to_string()])
            .output();
    }

    // 从进程表中移除
    store::remove_process(&entry.id);

    if json_output {
        println!(
            "{}",
            json!({
                "id": entry.id,
                "name": entry.name,
                "pid": entry.pid,
                "status": "stopped"
            })
        );
    } else {
        println!("✓ 进程 '{}' (PID: {}) 已停止", entry.name, entry.pid);
    }
}

/// 重启一个进程（先停止，再以相同参数启动）
pub fn restart(name_or_id: &str, json_output: bool) {
    let entry = match store::find_process(name_or_id) {
        Some(e) => e,
        None => {
            eprintln!("错误：找不到进程 '{}'", name_or_id);
            std::process::exit(1);
        }
    };

    // 保存重启所需的信息（含环境变量）
    let saved_command = entry.command.clone();
    let saved_name = entry.name.clone();
    let saved_cwd = entry.cwd.clone();
    let saved_env = entry.env.clone();

    // 先停止旧进程（静默）
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &entry.pid.to_string(), "/T", "/F"])
            .output();
    }

    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &entry.pid.to_string()])
            .output();
    }

    store::remove_process(&entry.id);

    // 以相同参数（含环境变量）重新启动
    start(&saved_command, Some(&saved_name), Some(&saved_cwd), &saved_env, json_output);
}

/// 列出所有进程
pub fn ps(project: Option<&str>, ports_only: bool, json_output: bool) {
    // 先同步所有进程状态
    sync_process_status();

    let mut entries = store::load_processes();

    // 按项目目录过滤
    if let Some(proj) = project {
        entries.retain(|e| e.cwd.contains(proj));
    }

    // 只显示有端口的进程
    if ports_only {
        entries.retain(|e| !e.port.is_empty());
    }

    if json_output {
        println!("{}", serde_json::to_string_pretty(&entries).unwrap_or_default());
        return;
    }

    if entries.is_empty() {
        println!("（没有进程记录）");
        return;
    }

    // 表格输出：ID, NAME, PID, PORT, STATUS, MEM, CPU, COMMAND
    println!(
        "{:<8} {:<20} {:<8} {:<8} {:<10} {:<10} {:<7} {}",
        "ID", "NAME", "PID", "PORT", "STATUS", "MEM", "CPU", "COMMAND"
    );
    println!("{}", "-".repeat(100));

    for e in &entries {
        let port_str = if e.port.is_empty() {
            "-".to_string()
        } else {
            e.port
                .iter()
                .map(|p| p.to_string())
                .collect::<Vec<_>>()
                .join(",")
        };

        // 截断过长的命令
        let cmd_display = if e.command.len() > 30 {
            format!("{}...", &e.command[..27])
        } else {
            e.command.clone()
        };

        // 仅对运行中的进程采集资源数据
        let (mem_display, cpu_display) = if e.status == "running" {
            let usage = super::resources::get_usage(e.pid);
            let cpu_str = if usage.cpu_percent > 0.0 {
                format!("{:.1}%", usage.cpu_percent)
            } else {
                "—".to_string()
            };
            (usage.memory_display, cpu_str)
        } else {
            ("—".to_string(), "—".to_string())
        };

        println!(
            "{:<8} {:<20} {:<8} {:<8} {:<10} {:<10} {:<7} {}",
            e.id,
            if e.name.len() > 20 { &e.name[..17] } else { &e.name },
            e.pid,
            port_str,
            e.status,
            mem_display,
            cpu_display,
            cmd_display
        );
    }
}
