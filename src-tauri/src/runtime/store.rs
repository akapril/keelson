use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tokio::sync::Notify;

/// 进程表变更通知：save_processes 后唤醒等待者。
/// rework 主进程订阅它，一有变更就 emit 事件给前端，实现「一有数据就显示」的实时刷新
/// （替代纯 4s 轮询；start/stop/exit/端口/健康变化都经 save_processes，覆盖全）。
pub fn change_notify() -> &'static Notify {
    static N: OnceLock<Notify> = OnceLock::new();
    N.get_or_init(Notify::new)
}

/// 进程表读-改-写串行锁：防止健康检查(10s)/看门狗(2s)/端口检测(1s) 并发写
/// processes.json 互相覆盖导致数据损坏。锁粒度=「整个 load+modify+save 序列」，
/// 进程表极小（几十条），串行代价可忽略。只在公开修改函数入口取锁，
/// save/load 内部不再取锁（避免重入死锁）。
fn table_lock() -> &'static Mutex<()> {
    static L: OnceLock<Mutex<()>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(()))
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
    /// 起自哪次 CLI 会话（intercept 自动托管时从 hook payload 记；手动启动为空）
    #[serde(default)]
    pub session_id: Option<String>,
    /// 会话 provider（claude / codex），配合 session_id 做跳转
    #[serde(default)]
    pub provider: Option<String>,
    /// 交互式 PTY 进程标记：true=经交互 PTY 启动（sudo 等需 stdin 的命令）。
    /// 看门狗不接管、restart 需用户重新交互启动。#[serde(default)] 兼容旧记录（默认 false）。
    #[serde(default)]
    pub interactive: bool,
    /// 显示名（用户可改）：空则回退用 name。name 仍为身份键（stop/restart/logs/冲突判定），
    /// label 仅影响列表展示。#[serde(default)] 兼容旧记录。
    #[serde(default)]
    pub label: Option<String>,
    /// 备注/描述：说明该命令的作用，用户可编辑。#[serde(default)] 兼容旧记录。
    #[serde(default)]
    pub note: Option<String>,
}

fn default_health() -> String {
    "unknown".to_string()
}

/// 获取 runtime 数据目录 (~/.claude-runtime/)。
/// 失败（无 home / 无法建目录）时回退系统临时目录，绝不 panic（跑在主进程）。
pub fn runtime_dir() -> PathBuf {
    let base = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join(".claude-runtime");
    // 建目录失败不致命：后续读写各自处理错误
    let _ = fs::create_dir_all(&dir);
    dir
}

/// 获取 stdout 日志目录。建目录失败不 panic。
pub fn stdout_dir() -> PathBuf {
    let dir = runtime_dir().join("stdout");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// 进程表文件路径
fn process_table_path() -> PathBuf {
    runtime_dir().join("processes.json")
}

/// 读取进程表。读失败或解析失败均返回空表（进程表不可读时不该崩 app）。
pub fn load_processes() -> Vec<ProcessEntry> {
    let path = process_table_path();
    if !path.exists() {
        return Vec::new();
    }
    match fs::read_to_string(&path) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(e) => {
            eprintln!("[runtime] 读取进程表失败（返回空表）: {e}");
            Vec::new()
        }
    }
}

/// 写入进程表。序列化/写盘失败时记日志但不 panic；成功后唤醒变更通知，供前端实时刷新。
pub fn save_processes(entries: &[ProcessEntry]) {
    let path = process_table_path();
    let data = match serde_json::to_string_pretty(entries) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[runtime] 序列化进程表失败: {e}");
            return;
        }
    };
    if let Err(e) = fs::write(&path, data) {
        eprintln!("[runtime] 写入进程表失败: {e}");
        return;
    }
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

/// 添加一个进程条目（读改写全序列持锁）
pub fn add_process(entry: ProcessEntry) {
    // 中毒锁也继续（into_inner），避免一次 panic 后所有进程操作永久死锁
    let _guard = table_lock().lock().unwrap_or_else(|e| e.into_inner());
    let mut entries = load_processes();
    entries.push(entry);
    save_processes(&entries);
}

/// 移除一个进程条目（按 ID，读改写全序列持锁）
pub fn remove_process(id: &str) {
    let _guard = table_lock().lock().unwrap_or_else(|e| e.into_inner());
    let mut entries = load_processes();
    entries.retain(|e| e.id != id);
    save_processes(&entries);
}

/// 更新一个进程条目的字段（读改写全序列持锁）
pub fn update_process<F>(id: &str, updater: F)
where
    F: FnOnce(&mut ProcessEntry),
{
    let _guard = table_lock().lock().unwrap_or_else(|e| e.into_inner());
    let mut entries = load_processes();
    if let Some(entry) = entries.iter_mut().find(|e| e.id == id) {
        updater(entry);
    }
    save_processes(&entries);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 旧记录 JSON 无 interactive 字段 → 反序列化应默认 false（serde(default)）
    #[test]
    fn process_entry_interactive_defaults_false_when_absent() {
        let json = r#"{
            "id":"abc123","name":"web","command":"npm run dev","cwd":"/tmp",
            "pid":1234,"port":[],"status":"running","started_at":"2026-07-29T00:00:00Z",
            "max_restarts":0,"restart_count":0
        }"#;
        let e: ProcessEntry = serde_json::from_str(json).expect("反序列化旧记录");
        assert!(!e.interactive);
    }
}

// 日志改纯文件方案：不再用 SQLite。init_log_db/insert_log 已移除，
// 日志读取见 daemon::read_tail_lines（读 <id>.log 尾部）。
