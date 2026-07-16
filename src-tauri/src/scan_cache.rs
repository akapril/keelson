// scan_cache.rs — 会话扫描缓存 + 增量更新（⑥ 启动秒加载）。
// 启动时先读缓存（秒级），后台只重解析 mtime 晚于缓存时间的 .jsonl 文件；
// 活跃使用时通常只有「当前会话」文件变化，避免每次全量重解析成千上万文件。
use crate::models::Session;
use crate::providers::{EventKind, ProviderRegistry};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 缓存格式版本；Session 结构或解析逻辑变动时应 +1，使旧缓存自动失效（退回全量）。
const CACHE_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
pub struct CacheData {
    pub version: u32,
    pub cached_at: DateTime<Utc>,
    pub sessions: Vec<Session>,
}

/// 读取缓存；版本不符或损坏返回 None（调用方退回全量扫描）。
pub fn load(path: &Path) -> Option<CacheData> {
    let bytes = std::fs::read(path).ok()?;
    let data: CacheData = serde_json::from_slice(&bytes).ok()?;
    if data.version != CACHE_VERSION {
        return None;
    }
    Some(data)
}

/// 保存缓存（以当前时间为基准时间戳）。
pub fn save(path: &Path, sessions: &[Session]) -> std::io::Result<()> {
    let data = CacheData {
        version: CACHE_VERSION,
        cached_at: Utc::now(),
        sessions: sessions.to_vec(),
    };
    let json = serde_json::to_vec(&data)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    std::fs::write(path, json)
}

/// 递归收集目录下所有 .jsonl 文件路径。
fn walk_jsonl(root: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(root) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk_jsonl(&p, out);
            } else if p.extension().map(|x| x == "jsonl").unwrap_or(false) {
                out.push(p);
            }
        }
    }
}

/// 文件最后修改时间（UTC）。
fn file_mtime(path: &Path) -> Option<DateTime<Utc>> {
    let m = std::fs::metadata(path).ok()?;
    Some(DateTime::<Utc>::from(m.modified().ok()?))
}

/// 按 session_id upsert（纯逻辑，可测）。
pub fn upsert(list: &mut Vec<Session>, s: Session) {
    if let Some(pos) = list.iter().position(|x| x.session_id == s.session_id) {
        list[pos] = s;
    } else {
        list.push(s);
    }
}

/// 增量更新：仅重解析 mtime 晚于 `cached.cached_at` 的 .jsonl 文件。
/// 返回 None 表示遇到结构性变化（FullRescan），调用方应改用全量 scan_all。
/// 注意：不处理「文件删除」（v1 取舍；删除极少，靠偶发全量或版本升级清理）。
pub fn incremental(reg: &ProviderRegistry, cached: CacheData) -> Option<Vec<Session>> {
    let since = cached.cached_at;
    let mut sessions = cached.sessions;

    let mut files = Vec::new();
    for root in reg.all_watch_roots() {
        walk_jsonl(&root.path, &mut files);
    }

    let mut changed = 0usize;
    for path in &files {
        let mt = match file_mtime(path) {
            Some(t) => t,
            None => continue,
        };
        if mt <= since {
            continue; // 未变化，复用缓存
        }
        match reg.route_path(path) {
            Some((provider, EventKind::Incremental)) => {
                if let Some(s) = provider.scan_one(path) {
                    upsert(&mut sessions, s);
                    changed += 1;
                }
            }
            // 结构性变化：退回全量，保证正确性
            Some((_, EventKind::FullRescan)) => return None,
            _ => {}
        }
    }

    eprintln!(
        "[rework] 增量扫描：{} 个文件变化，共 {} 条会话",
        changed,
        sessions.len()
    );
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Some(sessions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn mk(id: &str, mc: u32) -> Session {
        Session {
            session_id: id.into(),
            provider: "claude".into(),
            project_path: "/p".into(),
            project_name: "p".into(),
            first_prompt: String::new(),
            last_prompt: String::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            message_count: mc,
            user_messages: vec![],
            total_tokens: 0,
        }
    }

    #[test]
    fn upsert_replaces_or_appends() {
        let mut list = vec![mk("a", 1), mk("b", 1)];
        upsert(&mut list, mk("a", 9)); // 替换
        upsert(&mut list, mk("c", 1)); // 追加
        assert_eq!(list.len(), 3);
        assert_eq!(list.iter().find(|s| s.session_id == "a").unwrap().message_count, 9);
        assert!(list.iter().any(|s| s.session_id == "c"));
    }

    #[test]
    fn save_load_roundtrip_and_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("scan_cache.json");
        save(&path, &[mk("a", 3)]).unwrap();
        let loaded = load(&path).expect("应能读回");
        assert_eq!(loaded.version, CACHE_VERSION);
        assert_eq!(loaded.sessions.len(), 1);
        assert_eq!(loaded.sessions[0].session_id, "a");
    }

    #[test]
    fn load_missing_returns_none() {
        assert!(load(Path::new("/no/such/scan_cache.json")).is_none());
    }
}
