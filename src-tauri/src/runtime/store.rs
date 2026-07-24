use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 进程表条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessEntry {
    pub id: String,
    pub name: String,
    pub command: String,
    pub cwd: String,
    pub pid: u32,
    pub port: Vec<u16>,
    pub status: String, // "running" | "stopped" | "exited"
    pub started_at: DateTime<Utc>,
    /// 自动重启：最大重试次数（0 = 不重启）
    #[serde(default)]
    pub max_restarts: u32,
    /// 已重启次数
    #[serde(default)]
    pub restart_count: u32,
    /// 健康检查 URL（如 http://localhost:3000/health）
    #[serde(default)]
    pub health_url: Option<String>,
    /// 健康状态：healthy, unhealthy, unknown
    #[serde(default = "default_health")]
    pub health: String,
    /// 环境变量（启动时注入）
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
}

fn default_health() -> String {
    "unknown".to_string()
}

/// 获取 runtime 数据目录 (~/.claude-runtime/)
pub fn runtime_dir() -> PathBuf {
    let home = dirs::home_dir().expect("无法获取 home 目录");
    let dir = home.join(".claude-runtime");
    fs::create_dir_all(&dir).expect("无法创建 runtime 目录");
    dir
}

/// 获取 stdout 日志目录
pub fn stdout_dir() -> PathBuf {
    let dir = runtime_dir().join("stdout");
    fs::create_dir_all(&dir).expect("无法创建 stdout 目录");
    dir
}

/// 进程表文件路径
fn process_table_path() -> PathBuf {
    runtime_dir().join("processes.json")
}

/// 读取进程表
pub fn load_processes() -> Vec<ProcessEntry> {
    let path = process_table_path();
    if !path.exists() {
        return Vec::new();
    }
    let data = fs::read_to_string(&path).expect("无法读取进程表");
    serde_json::from_str(&data).unwrap_or_default()
}

/// 写入进程表
pub fn save_processes(entries: &[ProcessEntry]) {
    let path = process_table_path();
    let data = serde_json::to_string_pretty(entries).expect("无法序列化进程表");
    fs::write(&path, data).expect("无法写入进程表");
}

/// 按名称或 ID 查找进程
pub fn find_process(name_or_id: &str) -> Option<ProcessEntry> {
    let entries = load_processes();
    entries
        .into_iter()
        .find(|e| e.name == name_or_id || e.id == name_or_id)
}

/// 添加一个进程条目
pub fn add_process(entry: ProcessEntry) {
    let mut entries = load_processes();
    entries.push(entry);
    save_processes(&entries);
}

/// 移除一个进程条目（按 ID）
pub fn remove_process(id: &str) {
    let mut entries = load_processes();
    entries.retain(|e| e.id != id);
    save_processes(&entries);
}

/// 更新一个进程条目的字段
pub fn update_process<F>(id: &str, updater: F)
where
    F: FnOnce(&mut ProcessEntry),
{
    let mut entries = load_processes();
    if let Some(entry) = entries.iter_mut().find(|e| e.id == id) {
        updater(entry);
    }
    save_processes(&entries);
}

/// 初始化 SQLite 日志数据库（保留以备将来扩展）
#[allow(dead_code)]
pub fn init_log_db() -> Connection {
    let db_path = runtime_dir().join("logs.db");
    let conn = Connection::open(&db_path).expect("无法打开日志数据库");
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY,
            process_id TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            stream TEXT NOT NULL,
            level TEXT,
            raw TEXT NOT NULL,
            structured TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_process_time ON logs(process_id, timestamp);
        CREATE INDEX IF NOT EXISTS idx_level ON logs(level);",
    )
    .expect("无法初始化日志表");
    conn
}

/// 插入一条日志（保留以备将来扩展）
#[allow(dead_code)]
pub fn insert_log(
    conn: &Connection,
    process_id: &str,
    stream: &str,
    level: Option<&str>,
    raw: &str,
    structured: Option<&str>,
) {
    conn.execute(
        "INSERT INTO logs (process_id, stream, level, raw, structured) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![process_id, stream, level, raw, structured],
    )
    .expect("无法插入日志");
}
