use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use tokio::sync::Notify;

/// 进程表变更通知：save_processes 后唤醒等待者。
/// rework 主进程订阅它，一有变更就 emit 事件给前端，实现「一有数据就显示」的实时刷新
/// （替代纯 4s 轮询；start/stop/exit/端口/健康变化都经 save_processes，覆盖全）。
pub fn change_notify() -> &'static Notify {
    static N: OnceLock<Notify> = OnceLock::new();
    N.get_or_init(Notify::new)
}

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

/// 写入进程表。写完唤醒变更通知，供前端实时刷新。
pub fn save_processes(entries: &[ProcessEntry]) {
    let path = process_table_path();
    let data = serde_json::to_string_pretty(entries).expect("无法序列化进程表");
    fs::write(&path, data).expect("无法写入进程表");
    // 进程表已变更 → 唤醒订阅者（rework 主进程会 emit 给前端）
    change_notify().notify_waiters();
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
// 日志改纯文件方案：不再用 SQLite。init_log_db/insert_log 已移除，
// 日志读取见 daemon::read_tail_lines（读 <id>.log 尾部）。
