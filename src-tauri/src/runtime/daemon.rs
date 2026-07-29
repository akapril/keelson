/// daemon.rs — 进程管理内核（从 claude-runtime 融入，去 TCP 后为 rework 进程内纯模块）。
///
/// 不再是独立 TCP daemon：前端命令直接调 dispatch()/handle_*，无端口、无 pid、无多实例守卫。
/// 提供 start / stop / restart / ps / logs / remove / clean，以及后台 health/清理任务。
use std::collections::HashMap;
use std::process::Command;
use std::time::Duration;

use chrono::Utc;
use serde_json::{json, Value};
use uuid::Uuid;

use super::parser;
use super::port;
use super::process as proc_util;
use super::store;

// ─────────────────────────── 后台任务 ────────────────────────────

/// 起进程管理的后台任务（health 检查 10s / 旧日志清理 24h）。
/// 原本在 daemon::run 的 TCP 循环里起，去 TCP 后由 rework setup 直接调用。
pub fn start_background_tasks() {
    // 每 24h 清理旧日志
    tokio::spawn(async {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(86400)).await;
            super::clean::execute(7);
        }
    });
    // 每 10s 健康检查（有端口 / health_url 的运行中进程）
    tokio::spawn(async {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
            let entries = store::load_processes();
            for entry in &entries {
                if entry.status == "running"
                    && (!entry.port.is_empty() || entry.health_url.is_some())
                {
                    let health = super::health::check(&entry.health_url, &entry.port);
                    if health != entry.health {
                        let health_clone = health.clone();
                        let id = entry.id.clone();
                        store::update_process(&id, |e| {
                            e.health = health_clone;
                        });
                    }
                }
            }
        }
    });
}

// ─────────────────────── 命令分发（前端直调，无 TCP） ───────────────────────

/// 分发进程管理命令到对应 handler。前端 runtime_command 直接调用（同进程内，无 TCP/序列化）。
pub(crate) async fn dispatch(cmd: &str, args: &Value) -> Value {
    match cmd {
        "start" => handle_start(args).await,
        "stop" => handle_stop(args).await,
        "restart" => handle_restart(args).await,
        "ps" => handle_ps(args).await,
        "logs" => handle_logs(args).await,
        "remove" => handle_remove(args).await,
        "errors" => handle_errors(args).await,
        "clean" => handle_clean(args).await,
        other => json!({"error": format!("未知命令: {}", other)}),
    }
}

// ─────────────────────────── spawn 核心 ────────────────────────────

/// 建日志文件 + 平台化 spawn 子进程 + forget，返回 pid。
///
/// 供 `handle_start`（首次启动）与 `handle_restart`（原地重启）复用，统一 spawn 逻辑。
/// 日志用 `create+append`：首次新建、重启续写（保留历史，不清空）。
fn spawn_detached(
    id: &str,
    command: &str,
    working_dir: &str,
    env_vars: &HashMap<String, String>,
) -> Result<u32, String> {
    let log_path = store::stdout_dir().join(format!("{}.log", id));
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("无法打开日志文件: {}", e))?;
    let log_file_stderr = log_file
        .try_clone()
        .map_err(|e| format!("无法克隆日志文件句柄: {}", e))?;

    // 启动子进程（平台化）
    #[cfg(windows)]
    let spawn_result = {
        use std::os::windows::process::CommandExt;
        // chcp 65001 强制子进程输出 UTF-8，避免 GBK 乱码
        let utf8_command = format!("chcp 65001 >nul && {}", command);
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", &utf8_command])
            .current_dir(working_dir)
            .stdout(log_file)
            .stderr(log_file_stderr)
            .creation_flags(0x00000200); // CREATE_NEW_PROCESS_GROUP
        for (key, value) in env_vars {
            cmd.env(key, value);
        }
        cmd.spawn()
    };

    #[cfg(unix)]
    let spawn_result = {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", command])
            .current_dir(working_dir)
            .stdout(log_file)
            .stderr(log_file_stderr);
        for (key, value) in env_vars {
            cmd.env(key, value);
        }
        cmd.spawn()
    };

    let child = spawn_result.map_err(|e| format!("无法启动进程: {}", e))?;
    let pid = child.id();
    // 将子进程句柄遗忘，使其独立于守护进程运行
    std::mem::forget(child);
    Ok(pid)
}

// ─────────────────────────── handle_start ────────────────────────────

pub(crate) async fn handle_start(args: &Value) -> Value {
    // 从参数中提取字段
    let command = match args.get("command").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => return json!({"error": "缺少 'command' 参数"}),
    };

    // 生成 6 位短 ID
    let id = Uuid::new_v4().to_string()[..6].to_string();

    // 进程名称：参数中的 name 或默认使用 ID
    let process_name = args
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(&id)
        .to_string();

    // 检查名称冲突
    if store::find_process(&process_name).is_some() {
        return json!({
            "error": format!("进程名称 '{}' 已存在，请先停止该进程", process_name)
        });
    }

    // 工作目录
    let working_dir = args
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        });

    // 从参数中读取环境变量
    let env_vars: HashMap<String, String> = args
        .get("env")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // 建日志 + spawn（抽出的核心，与 handle_restart 复用）
    let pid = match spawn_detached(&id, &command, &working_dir, &env_vars) {
        Ok(p) => p,
        Err(e) => return json!({"error": e}),
    };

    // 自动重启策略
    let max_restarts = args
        .get("max_restarts")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;

    // 健康检查 URL（可选）
    let health_url = args
        .get("health_url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // 会话关联（intercept 自动托管时带；手动启动为空）
    let session_id = args
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let provider = args
        .get("provider")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // 构建进程条目并写入存储
    let entry = store::ProcessEntry {
        id: id.clone(),
        name: process_name.clone(),
        command: command.clone(),
        cwd: working_dir.clone(),
        pid,
        port: Vec::new(),
        status: "running".to_string(),
        started_at: Utc::now(),
        max_restarts,
        restart_count: 0,
        health_url,
        health: "unknown".to_string(),
        env: env_vars.clone(),
        session_id,
        provider,
        interactive: false,
    };
    store::add_process(entry);

    // 纯文件日志：子进程 stdout/stderr 已在 spawn_detached 内直接重定向到 <id>.log，
    // 无需捕获中转任务。handle_logs 读该文件尾部即可（去掉了原 SQLite 双写）。

    // 启动端口检测异步任务
    {
        let task_id = id.clone();
        let child_pid = pid;
        tokio::spawn(async move {
            for _ in 0..10 {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let ports = port::detect_ports(child_pid);
                if !ports.is_empty() {
                    store::update_process(&task_id, |e| {
                        e.port = ports;
                    });
                    break;
                }
            }
        });
    }

    // 启动进程看门狗（自动重启）
    if max_restarts > 0 {
        let wd_id = id.clone();
        let wd_cmd = command.clone();
        let wd_name = process_name.clone();
        let wd_cwd = working_dir.clone();
        let wd_env = env_vars.clone();
        tokio::spawn(async move {
            watchdog(wd_id, wd_cmd, wd_name, wd_cwd, wd_env, max_restarts).await;
        });
    }

    json!({
        "id": id,
        "name": process_name,
        "pid": pid,
        "status": "running",
        "command": command,
        "cwd": working_dir,
        "max_restarts": max_restarts
    })
}

// ─────────────────────────── handle_stop ────────────────────────────

pub(crate) async fn handle_stop(args: &Value) -> Value {
    let name_or_id = match args.get("name").and_then(|v| v.as_str()) {
        Some(n) => n.to_string(),
        None => return json!({"error": "缺少 'name' 参数"}),
    };

    let entry = match store::find_process(&name_or_id) {
        Some(e) => e,
        None => return json!({"error": format!("找不到进程 '{}'", name_or_id)}),
    };

    // 平台特定的进程终止
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

    // 停止 ≠ 删除：杀掉进程但保留记录（标记 stopped），日志文件也保留，
    // 用户仍能查看日志、事后再决定「删除」（handle_remove 才真正清记录+日志）。
    store::update_process(&entry.id, |e| {
        e.status = "stopped".to_string();
    });

    json!({
        "id": entry.id,
        "name": entry.name,
        "pid": entry.pid,
        "status": "stopped"
    })
}

// ─────────────────────────── handle_restart ────────────────────────────

pub(crate) async fn handle_restart(args: &Value) -> Value {
    let name_or_id = match args.get("name").and_then(|v| v.as_str()) {
        Some(n) => n.to_string(),
        None => return json!({"error": "缺少 'name' 参数"}),
    };

    let entry = match store::find_process(&name_or_id) {
        Some(e) => e,
        None => return json!({"error": format!("找不到进程 '{}'", name_or_id)}),
    };

    // 交互 PTY 进程无 TTY，无法无人值守重跑：pid=0 的 taskkill/kill 无效，
    // 且 PTY 会话由用户主导。返回提示，由前端引导用户重新交互启动。
    if entry.interactive {
        return json!({"error": "交互进程请停止后重新交互启动（restart 不支持无人值守重跑）"});
    }

    // 先停止旧进程（保留进程表条目，稍后原地更新，不 remove）
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

    // 原地重启：复用同一条目——同 id / name / started_at / 列表位置，只换 pid、状态、restart_count。
    // 不 remove_process、不换 id、不走 handle_start 的建新条目路径（否则名字冲突误判 + 跳到列表末尾）。
    // 不新起 watchdog：原 watchdog（若 max_restarts>0）继续，且按 entry.pid 判活（见 watchdog），
    // 会读到这里更新的新 pid → 判活为真、不会因旧 pid 已死而误触发自动重启。
    let new_pid = match spawn_detached(&entry.id, &entry.command, &entry.cwd, &entry.env) {
        Ok(p) => p,
        Err(e) => {
            // spawn 失败：旧进程已被 kill → 实际已停，标 exited 更准确。
            store::update_process(&entry.id, |x| {
                x.status = "exited".to_string();
            });
            return json!({"error": e});
        }
    };
    store::update_process(&entry.id, |x| {
        x.pid = new_pid;
        x.status = "running".to_string();
        x.restart_count = x.restart_count.saturating_add(1);
        x.port.clear(); // 旧端口失效，交给下面的端口检测任务重填
        x.health = "unknown".to_string();
    });

    // 重新起端口检测异步任务（针对同一 id + 新 pid，同 handle_start）
    {
        let task_id = entry.id.clone();
        let child_pid = new_pid;
        tokio::spawn(async move {
            for _ in 0..10 {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let ports = port::detect_ports(child_pid);
                if !ports.is_empty() {
                    store::update_process(&task_id, |e| {
                        e.port = ports;
                    });
                    break;
                }
            }
        });
    }

    json!({
        "id": entry.id,
        "name": entry.name,
        "pid": new_pid,
        "status": "running"
    })
}

// ─────────────────────────── handle_ps ────────────────────────────

pub(crate) async fn handle_ps(args: &Value) -> Value {
    // 先提参数（借用不能跨 spawn_blocking 的 'static 边界）
    let project = args
        .get("project")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let ports_only = args.get("ports").and_then(|v| v.as_bool()).unwrap_or(false);

    // handle_ps 全程同步阻塞采集：tasklist（判活）、文件读、资源采集、健康 TCP（2s 超时）。
    // 整体移入阻塞线程池，避免占用 async worker（进程多时会拖累 MCP 与其它命令响应）。
    tokio::task::spawn_blocking(move || {
        // 同步所有进程状态
        proc_util::sync_process_status();

        let mut entries = store::load_processes();

        // 按项目目录过滤：归一斜杠方向 + 忽略大小写后再比较。
        // 修 bug：cwd 与 repo_path 斜杠方向常不一致（D:\ vs D:/），字面 contains 会漏显
        // 属于该项目的进程。空字符串 project = 不过滤（供全局「进程」页用）。
        if let Some(project) = project {
            if !project.is_empty() {
                let norm = |s: &str| s.replace('\\', "/").to_lowercase();
                let np = norm(&project);
                entries.retain(|e| norm(&e.cwd).contains(&np));
            }
        }

        // 只显示有端口的进程
        if ports_only {
            entries.retain(|e| !e.port.is_empty());
        }

        // 为每个运行中的进程附加实时资源使用数据和健康状态（不持久化）
        let enriched: Vec<Value> = entries
            .iter()
            .map(|e| {
                let mut val = serde_json::to_value(e).unwrap_or(json!({}));
                if e.status == "running" {
                    let usage = super::resources::get_usage(e.pid);
                    val["resources"] = serde_json::to_value(&usage).unwrap_or(json!(null));
                    // 实时健康检查（仅在有端口或配置了 health_url 时执行）
                    if !e.port.is_empty() || e.health_url.is_some() {
                        let health = super::health::check(&e.health_url, &e.port);
                        val["health"] = json!(health);
                    }
                }
                val
            })
            .collect();

        json!(enriched)
    })
    .await
    .unwrap_or_else(|e| json!({"error": format!("进程列表采集失败: {}", e)}))
}

// ─────────────────────────── handle_logs ────────────────────────────

pub(crate) async fn handle_logs(args: &Value) -> Value {
    let name_or_id = match args.get("name").and_then(|v| v.as_str()) {
        Some(n) => n.to_string(),
        None => return json!({"error": "缺少 'name' 参数"}),
    };

    let entry = match store::find_process(&name_or_id) {
        Some(e) => e,
        None => return json!({"error": format!("找不到进程 '{}'", name_or_id)}),
    };

    // 解析过滤参数
    let level_filter = args.get("level").and_then(|v| v.as_str()).map(|s| s.to_string());
    let grep_filter = args.get("grep").and_then(|v| v.as_str()).map(|s| s.to_string());
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(50) as usize;

    // 纯文件：直接读 <id>.log 的尾部最后 limit 行（反向按块读，不整读，
    // 大日志也不爆内存）。注：since(按时间) 依赖每行时间戳，纯文件下不再支持（前端未用）。
    let log_path = store::stdout_dir().join(format!("{}.log", entry.id));
    let lines = read_tail_lines(&log_path, limit.max(1));

    // 逐行解析级别 + 可选 grep/level 过滤，正序返回
    let rows: Vec<Value> = lines
        .into_iter()
        .filter(|raw| !raw.is_empty())
        .filter(|raw| grep_filter.as_ref().map(|g| raw.contains(g)).unwrap_or(true))
        .map(|raw| {
            let parsed = parser::parse_line(&raw);
            json!({ "timestamp": null, "level": parsed.level, "raw": raw })
        })
        .filter(|row| {
            level_filter
                .as_ref()
                .map(|lvl| row["level"].as_str() == Some(lvl.as_str()))
                .unwrap_or(true)
        })
        .collect();

    json!(rows)
}

// ─────────────────────────── handle_remove ────────────────────────────

/// 从进程表移除一个「已退出/已停止」的进程记录并删其日志文件（不 kill）。
/// 用于清理死条目；running 的请先 stop。
pub(crate) async fn handle_remove(args: &Value) -> Value {
    let name_or_id = match args.get("name").and_then(|v| v.as_str()) {
        Some(n) => n.to_string(),
        None => return json!({"error": "缺少 'name' 参数"}),
    };
    let entry = match store::find_process(&name_or_id) {
        Some(e) => e,
        None => return json!({"error": format!("找不到进程 '{}'", name_or_id)}),
    };
    // running 且 PID 仍存活 → 拒绝，避免留下孤儿进程
    if entry.status == "running" && proc_util::is_pid_alive(entry.pid) {
        return json!({"error": "进程仍在运行，请先停止再删除"});
    }
    store::remove_process(&entry.id);
    // 删日志文件（失败无所谓）
    let log_path = store::stdout_dir().join(format!("{}.log", entry.id));
    let _ = std::fs::remove_file(&log_path);
    json!({ "id": entry.id, "name": entry.name, "removed": true })
}

// ─────────────────────────── handle_errors ────────────────────────────

/// 分析进程错误日志，返回结构化错误摘要
pub(crate) async fn handle_errors(args: &Value) -> Value {
    let name = match args.get("name").and_then(|v| v.as_str()) {
        Some(n) => n,
        None => return json!({"error": "缺少 name 参数"}),
    };
    match super::errors::analyze(name) {
        Ok(summary) => {
            serde_json::to_value(&summary).unwrap_or(json!({"error": "序列化失败"}))
        }
        Err(e) => json!({"error": e}),
    }
}

// ─────────────────────────── handle_clean ────────────────────────────

/// 执行日志清理，返回 JSON 结果
pub(crate) async fn handle_clean(args: &Value) -> Value {
    // 从参数中获取保留天数，默认 7 天
    let days = args
        .get("days")
        .and_then(|v| v.as_u64())
        .unwrap_or(7) as u32;

    let result = super::clean::execute(days);
    serde_json::to_value(&result).unwrap_or(json!({"error": "序列化失败"}))
}


// ─────────────────────────── 进程看门狗 ────────────────────────────

/// 监控进程，崩溃后自动重启（最多 max_restarts 次）
async fn watchdog(
    process_id: String,
    command: String,
    name: String,
    cwd: String,
    env_vars: HashMap<String, String>,
    max_restarts: u32,
) {
    let mut restart_count: u32 = 0;

    loop {
        // 每 2 秒检查一次进程是否存活
        tokio::time::sleep(Duration::from_secs(2)).await;

        // 检查进程是否还在表中（可能被用户 stop 了）
        let entry = match store::find_process(&name) {
            Some(e) => e,
            None => {
                eprintln!("[watchdog] 进程 '{}' 已被移除，停止监控", name);
                break;
            }
        };

        // 如果状态已经不是 running（被用户手动 stop），退出
        if entry.status == "stopped" {
            break;
        }

        // 检查进程是否存活：按 entry 的**当前** pid 判活（而非本地旧 pid）。
        // 这样手动原地 restart 更新 entry.pid 后，watchdog 读到新 pid 判活为真 → 不误触发自动重启。
        if proc_util::is_pid_alive(entry.pid) {
            continue;
        }

        // 进程已退出
        restart_count += 1;
        if restart_count > max_restarts {
            eprintln!(
                "[watchdog] 进程 '{}' 已退出，已达最大重启次数 ({}/{})",
                name, restart_count - 1, max_restarts
            );
            store::update_process(&process_id, |e| {
                e.status = "exited".to_string();
                e.restart_count = restart_count - 1;
            });
            break;
        }

        eprintln!(
            "[watchdog] 进程 '{}' 崩溃，自动重启 ({}/{})",
            name, restart_count, max_restarts
        );

        // 等 1 秒再重启，避免疯狂循环
        tokio::time::sleep(Duration::from_secs(1)).await;

        // 用统一 spawn 核心重启（与 handle_start/handle_restart 同一实现；日志 append 续写）
        match spawn_detached(&process_id, &command, &cwd, &env_vars) {
            Ok(new_pid) => {
                store::update_process(&process_id, |e| {
                    e.pid = new_pid;
                    e.status = "running".to_string();
                    e.restart_count = restart_count;
                    e.port = Vec::new(); // 端口可能变了，重新检测
                });

                // 重新启动端口检测
                let port_id = process_id.clone();
                let port_pid = new_pid;
                tokio::spawn(async move {
                    for _ in 0..10 {
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        let ports = port::detect_ports(port_pid);
                        if !ports.is_empty() {
                            store::update_process(&port_id, |e| {
                                e.port = ports;
                            });
                            break;
                        }
                    }
                });

                eprintln!("[watchdog] 进程 '{}' 已重启，新 PID: {}", name, new_pid);
            }
            Err(e) => {
                eprintln!("[watchdog] 重启失败: {}", e);
                store::update_process(&process_id, |e| {
                    e.status = "exited".to_string();
                });
                break;
            }
        }
    }
}

// ─────────────────────────── 工具函数 ────────────────────────────

/// 解码一行日志字节：优先严格 UTF-8；失败则按 GB18030（GBK 超集，简体中文
/// Windows 子进程常用的 ANSI 编码）解码。纯 ASCII 与纯 UTF-8 走前者，
/// GBK 输出走后者，避免非法字节被 lossy 成 � 乱码。
fn decode_log_bytes(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => {
            // GB18030 解码不会失败（有替换），对 GBK/GB2312/GB18030 均正确
            let (cow, _, _) = encoding_rs::GB18030.decode(bytes);
            cow.into_owned()
        }
    }
}

/// 读文件尾部最后 max_lines 行：从文件末尾反向按 64KB 块读，最多回读 4MB，
/// 避免大日志整读爆内存。用 decode_log_bytes 智能解码(UTF-8/GBK)，返回时间正序的行。
fn read_tail_lines(path: &std::path::Path, max_lines: usize) -> Vec<String> {
    use std::io::{Read, Seek, SeekFrom};
    const CHUNK: u64 = 64 * 1024;
    const MAX_TAIL_BYTES: u64 = 4 * 1024 * 1024; // 尾部最多回读 4MB

    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        return Vec::new();
    }
    let mut buf: Vec<u8> = Vec::new();
    let mut pos = size;
    let mut newlines = 0usize;
    // 回读直到攒够行数 / 到文件头 / 达到回读上限
    while pos > 0 && newlines <= max_lines && (size - pos) < MAX_TAIL_BYTES {
        let read = CHUNK.min(pos);
        pos -= read;
        if file.seek(SeekFrom::Start(pos)).is_err() {
            break;
        }
        let mut tmp = vec![0u8; read as usize];
        if file.read_exact(&mut tmp).is_err() {
            break;
        }
        tmp.extend_from_slice(&buf);
        buf = tmp;
        newlines = buf.iter().filter(|&&b| b == b'\n').count();
    }
    let text = decode_log_bytes(&buf);
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(max_lines);
    all[start..].iter().map(|s| s.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_utf8_and_gbk() {
        // 纯 ASCII：UTF-8 路径
        assert_eq!(decode_log_bytes(b"hello world"), "hello world");
        // UTF-8 中文：严格解码成功
        assert_eq!(decode_log_bytes("编译完成".as_bytes()), "编译完成");
        // GBK 中文字节（"编译"的 GBK 编码 B1 E0 D2 EB）：回退 GB18030 正确解码
        let gbk = [0xB1u8, 0xE0, 0xD2, 0xEB];
        assert_eq!(decode_log_bytes(&gbk), "编译");
        // GBK 混 ASCII（"错误: fail" 的 GBK）：cuo wu = B4 ED CE F3
        let mixed = [0xB4u8, 0xED, 0xCE, 0xF3, 0x3A, 0x20, 0x66, 0x61, 0x69, 0x6C];
        assert_eq!(decode_log_bytes(&mixed), "错误: fail");
    }
}
