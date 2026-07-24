/// daemon.rs — claude-runtime 守护进程模块
///
/// 在 127.0.0.1:19191 上运行 TCP 服务器，接受 JSON 命令并管理子进程。
/// 支持 start / stop / restart / ps / logs / ping 命令。
use std::io::BufRead as _;
use std::net::{SocketAddr, TcpListener as StdTcpListener};
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use socket2::{Domain, Protocol, Socket, Type};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use uuid::Uuid;

use super::parser;
use super::port;
use super::process as proc_util;
use super::store;

use std::collections::HashMap;

// ─────────────────────────── 公共工具函数 ────────────────────────────

/// 返回 PID 文件路径：~/.claude-runtime/daemon.pid
pub fn pid_file_path() -> PathBuf {
    store::runtime_dir().join("daemon.pid")
}

/// 检查守护进程是否正在运行（PID 文件存在 + 进程存活）
pub fn is_daemon_running() -> bool {
    let path = pid_file_path();
    if !path.exists() {
        return false;
    }
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let pid: u32 = match content.trim().parse() {
        Ok(p) => p,
        Err(_) => return false,
    };
    proc_util::is_pid_alive(pid)
}

// ─────────────────────────── 协议结构体 ────────────────────────────

/// 客户端发来的命令报文
#[derive(Debug, Deserialize)]
struct DaemonRequest {
    cmd: String,
    #[serde(default)]
    args: Value,
}

// ─────────────────────────── 主入口 ────────────────────────────

/// 守护进程主循环：绑定 TCP 端口，持续接受连接
pub async fn run() {
    // 防止多实例：检查是否已有 daemon 在运行
    if is_daemon_running() {
        eprintln!("[daemon] 已有 daemon 实例在运行，跳过启动");
        return;
    }

    let pid = std::process::id();
    let pid_path = pid_file_path();

    // 使用 socket2 以 SO_REUSEADDR 方式绑定，避免 TIME_WAIT 状态导致启动失败。
    // 融入 rework 进程内：绑定失败（端口被占等）时优雅返回、不 panic，
    // 以免中断 rework 启动流程；前端会显示「未运行」，可手动重试。
    let bind = || -> std::io::Result<TcpListener> {
        let addr: SocketAddr = "127.0.0.1:19191".parse().map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "地址解析失败")
        })?;
        let sock = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))?;
        sock.set_reuse_address(true)?;
        sock.set_nonblocking(true)?;
        sock.bind(&addr.into())?;
        sock.listen(128)?;
        let std_listener: StdTcpListener = sock.into();
        TcpListener::from_std(std_listener)
    };
    let listener = match bind() {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[daemon] 绑定 127.0.0.1:19191 失败（端口被占？）：{e}");
            return;
        }
    };

    // 绑定成功后写入 PID 文件并打印启动消息
    if let Err(e) = std::fs::write(&pid_path, pid.to_string()) {
        eprintln!("[daemon] 写入 PID 文件失败：{e}");
    }
    eprintln!("[daemon] 启动成功（进程内），PID={}，监听 127.0.0.1:19191", pid);

    // 注：已融入 rework 进程内（headless）——不再起独立 HTTP 控制台（:19192 Dashboard）
    // 与独立系统托盘；进程管理 UI 由 rework 的「进程」tab 承担，托盘复用 rework 自身。

    // 启动每 24 小时自动清理旧日志的后台任务
    tokio::spawn(async {
        loop {
            // 首次等待 24 小时后执行，避免启动时立即清理
            tokio::time::sleep(std::time::Duration::from_secs(86400)).await;
            eprintln!("[daemon] 自动清理旧日志...");
            super::clean::execute(7);
        }
    });

    // 启动每 10 秒执行一次的后台健康检查任务
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
                        if health == "unhealthy" {
                            eprintln!("[health] 进程 '{}' 健康检查失败", entry.name);
                        }
                    }
                }
            }
        }
    });

    // 主接受循环
    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                eprintln!("[daemon] 接受连接来自 {}", addr);
                tokio::spawn(async move {
                    handle_connection(stream).await;
                });
            }
            Err(e) => {
                eprintln!("[daemon] 接受连接失败: {}", e);
            }
        }
    }

    // 注意：此处永不到达，PID 文件在 ctrl_c 处理器中清理
}

// ─────────────────────────── 连接处理 ────────────────────────────

/// 处理单个 TCP 连接：读取一行 JSON，分发命令，写回响应
async fn handle_connection(stream: tokio::net::TcpStream) {
    let (reader, mut writer) = stream.into_split();
    let mut buf_reader = BufReader::new(reader);
    let mut line = String::new();

    // 读取一行 JSON 请求
    match buf_reader.read_line(&mut line).await {
        Ok(0) | Err(_) => return, // 连接已关闭或读取错误
        Ok(_) => {}
    }

    let response = match serde_json::from_str::<DaemonRequest>(line.trim()) {
        Ok(req) => dispatch(req).await,
        Err(e) => {
            json!({"error": format!("JSON 解析失败: {}", e)})
        }
    };

    // 写回 JSON 响应（以换行结尾）
    let mut response_str = response.to_string();
    response_str.push('\n');
    let _ = writer.write_all(response_str.as_bytes()).await;
}

// ─────────────────────────── 命令分发 ────────────────────────────

/// 根据 cmd 字段分发到对应处理函数
async fn dispatch(req: DaemonRequest) -> Value {
    match req.cmd.as_str() {
        "ping" => json!({"pong": true, "ts": Utc::now().to_rfc3339()}),
        "start" => handle_start(&req.args).await,
        "stop" => handle_stop(&req.args).await,
        "restart" => handle_restart(&req.args).await,
        "ps" => handle_ps(&req.args).await,
        "logs" => handle_logs(&req.args).await,
        "errors" => handle_errors(&req.args).await,
        "clean" => handle_clean(&req.args).await,
        other => json!({"error": format!("未知命令: {}", other)}),
    }
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

    // 创建日志文件
    let log_path = store::stdout_dir().join(format!("{}.log", id));
    let log_file = match std::fs::File::create(&log_path) {
        Ok(f) => f,
        Err(e) => return json!({"error": format!("无法创建日志文件: {}", e)}),
    };
    let log_file_stderr = match log_file.try_clone() {
        Ok(f) => f,
        Err(e) => return json!({"error": format!("无法克隆日志文件句柄: {}", e)}),
    };

    // 从参数中读取环境变量
    let env_vars: HashMap<String, String> = args
        .get("env")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // 启动子进程
    #[cfg(windows)]
    let spawn_result = {
        use std::os::windows::process::CommandExt;
        // chcp 65001 强制子进程输出 UTF-8，避免 GBK 乱码
        let utf8_command = format!("chcp 65001 >nul && {}", command);
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", &utf8_command])
            .current_dir(&working_dir)
            .stdout(log_file)
            .stderr(log_file_stderr)
            .creation_flags(0x00000200); // CREATE_NEW_PROCESS_GROUP
        // 注入环境变量
        for (key, value) in &env_vars {
            cmd.env(key, value);
        }
        cmd.spawn()
    };

    #[cfg(unix)]
    let spawn_result = {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", &command])
            .current_dir(&working_dir)
            .stdout(log_file)
            .stderr(log_file_stderr);
        // 注入环境变量
        for (key, value) in &env_vars {
            cmd.env(key, value);
        }
        cmd.spawn()
    };

    let child = match spawn_result {
        Ok(c) => c,
        Err(e) => return json!({"error": format!("无法启动进程: {}", e)}),
    };

    let pid = child.id();
    // 将子进程句柄遗忘，使其独立于守护进程运行
    std::mem::forget(child);

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
    };
    store::add_process(entry);

    // 启动日志捕获异步任务
    {
        let task_id = id.clone();
        let task_log_path = log_path.clone();
        tokio::spawn(async move {
            daemon_log_capture(task_id, task_log_path).await;
        });
    }

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
            watchdog(wd_id, wd_cmd, wd_name, wd_cwd, wd_env, pid, max_restarts).await;
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

    // 从进程表移除
    store::remove_process(&entry.id);

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

    // 保存重启所需的原始参数（含环境变量）
    let saved_command = entry.command.clone();
    let saved_name = entry.name.clone();
    let saved_cwd = entry.cwd.clone();
    let saved_env = entry.env.clone();

    // 先停止旧进程
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
    let start_args = json!({
        "command": saved_command,
        "name": saved_name,
        "cwd": saved_cwd,
        "env": saved_env,
    });
    handle_start(&start_args).await
}

// ─────────────────────────── handle_ps ────────────────────────────

pub(crate) async fn handle_ps(args: &Value) -> Value {
    // 同步所有进程状态
    proc_util::sync_process_status();

    let mut entries = store::load_processes();

    // 按项目目录过滤
    if let Some(project) = args.get("project").and_then(|v| v.as_str()) {
        entries.retain(|e| e.cwd.contains(project));
    }

    // 只显示有端口的进程
    let ports_only = args
        .get("ports")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if ports_only {
        entries.retain(|e| !e.port.is_empty());
    }

    // 为每个运行中的进程附加实时资源使用数据和健康状态（不持久化）
    let enriched: Vec<Value> = entries.iter().map(|e| {
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
    }).collect();

    json!(enriched)
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

    // 解析 since 参数（如 "5m" → 300 秒）
    let since_secs: Option<i64> = args.get("since").and_then(|v| v.as_str()).and_then(|s| parse_duration(s));

    // 从 SQLite 查询日志
    let conn = match std::panic::catch_unwind(|| store::init_log_db()) {
        Ok(c) => c,
        Err(_) => return json!({"error": "无法打开日志数据库"}),
    };

    // 构建 SQL 查询
    let mut sql = format!(
        "SELECT timestamp, level, raw, structured FROM logs WHERE process_id = '{}'",
        entry.id.replace('\'', "''") // 简单 SQL 注入防护
    );

    if let Some(lvl) = &level_filter {
        sql.push_str(&format!(" AND level = '{}'", lvl.replace('\'', "''")));
    }

    if let Some(secs) = since_secs {
        sql.push_str(&format!(
            " AND timestamp >= datetime('now', '-{} seconds')",
            secs
        ));
    }

    if let Some(pat) = &grep_filter {
        sql.push_str(&format!(
            " AND raw LIKE '%{}%'",
            pat.replace('\'', "''").replace('%', "\\%").replace('_', "\\_")
        ));
    }

    sql.push_str(&format!(" ORDER BY timestamp DESC LIMIT {}", limit));

    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(e) => return json!({"error": format!("SQL 准备失败: {}", e)}),
    };

    let rows: Vec<Value> = stmt
        .query_map([], |row| {
            let timestamp: String = row.get(0)?;
            let level: Option<String> = row.get(1)?;
            let raw: String = row.get(2)?;
            let structured: Option<String> = row.get(3)?;
            Ok(json!({
                "timestamp": timestamp,
                "level": level,
                "raw": raw,
                "structured": structured
            }))
        })
        .map(|mapped| {
            mapped
                .filter_map(|r| r.ok())
                .collect()
        })
        .unwrap_or_default();

    // 日志以时间正序返回（反转 DESC 结果）
    let mut rows = rows;
    rows.reverse();

    json!(rows)
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

// ─────────────────────────── 日志捕获任务 ────────────────────────────

/// 持续从日志文件读取新行，解析后写入 SQLite
/// 在 tokio::spawn 中运行，每个进程一个独立任务
async fn daemon_log_capture(process_id: String, log_file_path: PathBuf) {
    // 在阻塞上下文中执行文件读取，避免阻塞 tokio 运行时
    let pid_id = process_id.clone();
    let path = log_file_path.clone();

    tokio::task::spawn_blocking(move || {
        // 为此任务独立打开一个 SQLite 连接
        let conn = match std::panic::catch_unwind(|| store::init_log_db()) {
            Ok(c) => c,
            Err(_) => {
                eprintln!("[daemon_log_capture] 无法打开 SQLite 数据库");
                return;
            }
        };

        // 等待日志文件创建完成
        let mut retries = 0;
        let file = loop {
            match std::fs::File::open(&path) {
                Ok(f) => break f,
                Err(_) => {
                    retries += 1;
                    if retries > 20 {
                        eprintln!("[daemon_log_capture] 等待日志文件超时: {:?}", path);
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
            }
        };

        // 使用字节读取以兼容非 UTF-8 编码输出（如 Windows ping 命令）
        let mut reader = std::io::BufReader::new(file);
        let mut byte_buf = Vec::new();

        loop {
            byte_buf.clear();
            match reader.read_until(b'\n', &mut byte_buf) {
                Ok(0) => {
                    // 没有新数据，检查进程是否仍在运行
                    match store::find_process(&pid_id) {
                        Some(e) if e.status == "running" => {
                            // 进程仍在运行，等待新日志
                            std::thread::sleep(Duration::from_millis(200));
                            continue;
                        }
                        _ => {
                            // 进程已停止，退出日志捕获
                            eprintln!("[daemon_log_capture] 进程 {} 已停止，日志捕获结束", pid_id);
                            break;
                        }
                    }
                }
                Ok(_) => {
                    // 智能解码：优先严格 UTF-8，失败回退 GB18030（GBK 超集）。
                    // 修 Windows 中文子进程（npm/python 等）按系统 ANSI(GBK) 输出时
                    // 被 from_utf8_lossy 当 UTF-8 解成 � 乱码的问题。
                    let decoded = decode_log_bytes(&byte_buf);
                    let raw = decoded.trim_end_matches('\n').trim_end_matches('\r');
                    if raw.is_empty() {
                        continue;
                    }
                    let parsed = parser::parse_line(raw);
                    store::insert_log(
                        &conn,
                        &pid_id,
                        "stdout",
                        parsed.level.as_deref(),
                        raw,
                        parsed.structured.as_deref(),
                    );
                }
                Err(e) => {
                    eprintln!("[daemon_log_capture] 读取日志文件错误: {}", e);
                    break;
                }
            }
        }
    })
    .await
    .ok();
}

// ─────────────────────────── 进程看门狗 ────────────────────────────

/// 监控进程，崩溃后自动重启（最多 max_restarts 次）
async fn watchdog(
    process_id: String,
    command: String,
    name: String,
    cwd: String,
    env_vars: HashMap<String, String>,
    mut current_pid: u32,
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

        // 检查进程是否存活
        if proc_util::is_pid_alive(current_pid) {
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

        // 重新创建日志文件
        let log_path = store::stdout_dir().join(format!("{}.log", process_id));
        let log_file = match std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("[watchdog] 无法打开日志文件: {}", e);
                break;
            }
        };
        let log_file_err = match log_file.try_clone() {
            Ok(f) => f,
            Err(_) => break,
        };

        // 重新启动子进程（含环境变量注入）
        #[cfg(windows)]
        let spawn_result = {
            use std::os::windows::process::CommandExt;
            let utf8_cmd = format!("chcp 65001 >nul && {}", command);
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", &utf8_cmd])
                .current_dir(&cwd)
                .stdout(log_file)
                .stderr(log_file_err)
                .creation_flags(0x00000200);
            for (key, value) in &env_vars {
                cmd.env(key, value);
            }
            cmd.spawn()
        };

        #[cfg(unix)]
        let spawn_result = {
            let mut cmd = Command::new("sh");
            cmd.args(["-c", &command])
                .current_dir(&cwd)
                .stdout(log_file)
                .stderr(log_file_err);
            for (key, value) in &env_vars {
                cmd.env(key, value);
            }
            cmd.spawn()
        };

        match spawn_result {
            Ok(child) => {
                let new_pid = child.id();
                std::mem::forget(child);
                current_pid = new_pid;

                // 更新进程表
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

                eprintln!(
                    "[watchdog] 进程 '{}' 已重启，新 PID: {}",
                    name, new_pid
                );
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

/// 解析持续时间字符串，如 "5m" → 300，"1h" → 3600，"30s" → 30
fn parse_duration(s: &str) -> Option<i64> {
    let s = s.trim();
    if let Some(num_str) = s.strip_suffix('m') {
        num_str.parse::<i64>().ok().map(|n| n * 60)
    } else if let Some(num_str) = s.strip_suffix('h') {
        num_str.parse::<i64>().ok().map(|n| n * 3600)
    } else if let Some(num_str) = s.strip_suffix('s') {
        num_str.parse::<i64>().ok()
    } else {
        // 无单位时视为秒
        s.parse::<i64>().ok()
    }
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
