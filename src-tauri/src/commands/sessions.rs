// commands/sessions.rs — 会话相关 Tauri 命令（Task 16）
// 职责：从 AppState 中读取缓存会话、调用 Tantivy 搜索、读取时间轴等。
// 所有命令均为薄包装层，不含任何业务逻辑。

use crate::AppState;
use crate::models::{Session, TimelineMessage};
use crate::search::SessionHit;
use tauri::State;

/// 搜索结果默认上限（性能 + YAGNI：MVP 阶段 200 条足够）
const SEARCH_LIMIT: usize = 200;

// ─────────────────────────────────────────────────────────────
// 纯辅助函数（可单元测试，不依赖 Tauri State）
// ─────────────────────────────────────────────────────────────

/// 从会话列表中提取去重的项目路径，保持首次出现顺序。
///
/// 此函数为纯函数，不依赖任何 IO 或全局状态，便于单元测试。
pub fn distinct_project_paths(sessions: &[Session]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for s in sessions {
        if seen.insert(s.project_path.clone()) {
            result.push(s.project_path.clone());
        }
    }
    result
}

// ─────────────────────────────────────────────────────────────
// Tauri 命令
// ─────────────────────────────────────────────────────────────

/// 返回缓存的全量会话列表（由启动扫描 + Watcher 维护）。
#[tauri::command]
pub fn sessions_list(state: State<AppState>) -> Vec<Session> {
    state.sessions.lock().clone()
}

/// 全文搜索会话，最多返回 SEARCH_LIMIT 条结果。
/// 若 Tantivy 索引尚未就绪，返回空列表（非致命）。
#[tauri::command]
pub fn sessions_search(query: String, state: State<AppState>) -> Vec<SessionHit> {
    let guard = state.index.lock();
    match guard.as_ref() {
        Some(idx) => crate::search::session_backend::search(idx, &query, SEARCH_LIMIT),
        // 索引未就绪（初始化中或构建失败）：静默返回空
        None => Vec::new(),
    }
}

/// 读取指定会话的时间轴消息列表（详情页用）。
/// 若 provider 不存在，返回空列表。
#[tauri::command]
pub fn sessions_timeline(
    provider: String,
    session_id: String,
    state: State<AppState>,
) -> Vec<TimelineMessage> {
    match state.reg.by_id(&provider) {
        Some(p) => p.read_timeline(&session_id),
        None => {
            eprintln!("[rework] sessions_timeline: 未知 provider '{provider}'");
            Vec::new()
        }
    }
}

/// 返回所有会话中去重后的项目路径列表。
#[tauri::command]
pub fn sessions_project_paths(state: State<AppState>) -> Vec<String> {
    let sessions = state.sessions.lock();
    distinct_project_paths(&sessions)
}

/// 会话→提交关联的默认宽限（4h）：提交常在会话结束后不久。
/// 前端 commit→会话 反查用同值（src/features/sessions/commit-correlate.ts 的 COMMIT_GRACE_SECS），改此处需同步。
const COMMIT_GRACE_SECS: i64 = 14400;

/// 返回与指定会话关联的提交（trailer 精确 / 时间窗可能相关）。
/// 判据单点在 git::correlate_session_commits，避免前后端两份逻辑漂移。
/// 会话不存在 / 非 git 仓库 / git 失败 → 空列表。
#[tauri::command]
pub fn session_commits(
    session_id: String,
    provider: String,
    state: State<AppState>,
) -> Vec<crate::commands::git::CorrelatedCommit> {
    // 取该会话的仓库路径与起止时间
    let sess = {
        let guard = state.sessions.lock();
        match guard
            .iter()
            .find(|s| s.session_id == session_id && s.provider == provider)
        {
            Some(s) => s.clone(),
            None => return Vec::new(),
        }
    };
    // 取数下界放宽到 created - grace：既覆盖时间窗候选，也让「略早于会话创建但 trailer 命中」
    // 的提交进入 correlate（避免 git --since 把精确关联先于 trailer 判据切掉）。correlate 再定性。
    let since = (sess.created_at - chrono::Duration::seconds(COMMIT_GRACE_SECS)).to_rfc3339();
    let commits = crate::commands::git::git_log(sess.project_path.clone(), Some(since), None, 500);
    crate::commands::git::correlate_session_commits(
        sess.created_at,
        sess.updated_at,
        &session_id,
        commits,
        COMMIT_GRACE_SECS,
    )
}

// ─────────────────────────────────────────────────────────────
// 单元测试
// ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    /// 构造测试用 Session（最小化字段填充）
    fn make_session(session_id: &str, project_path: &str) -> Session {
        Session {
            session_id: session_id.to_string(),
            provider: "claude".to_string(),
            project_path: project_path.to_string(),
            project_name: project_path.split('/').last().unwrap_or("").to_string(),
            first_prompt: String::new(),
            last_prompt: String::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            message_count: 0,
            user_messages: Vec::new(),
            total_tokens: 0,
        }
    }

    /// 空输入时应返回空列表
    #[test]
    fn distinct_paths_empty() {
        let result = distinct_project_paths(&[]);
        assert!(result.is_empty());
    }

    /// 无重复时应返回全部路径
    #[test]
    fn distinct_paths_no_duplicates() {
        let sessions = vec![
            make_session("s1", "/home/user/proj-a"),
            make_session("s2", "/home/user/proj-b"),
        ];
        let paths = distinct_project_paths(&sessions);
        assert_eq!(paths.len(), 2);
        assert!(paths.contains(&"/home/user/proj-a".to_string()));
        assert!(paths.contains(&"/home/user/proj-b".to_string()));
    }

    /// 有重复路径时应去重，且保持首次出现顺序
    #[test]
    fn distinct_paths_deduplicates() {
        let sessions = vec![
            make_session("s1", "/home/user/proj-a"),
            make_session("s2", "/home/user/proj-b"),
            make_session("s3", "/home/user/proj-a"), // 重复
            make_session("s4", "/home/user/proj-c"),
            make_session("s5", "/home/user/proj-b"), // 重复
        ];
        let paths = distinct_project_paths(&sessions);
        assert_eq!(paths.len(), 3);
        // 首次出现顺序：proj-a, proj-b, proj-c
        assert_eq!(paths[0], "/home/user/proj-a");
        assert_eq!(paths[1], "/home/user/proj-b");
        assert_eq!(paths[2], "/home/user/proj-c");
    }

    /// 全部相同路径时只保留一个
    #[test]
    fn distinct_paths_all_same() {
        let sessions = vec![
            make_session("s1", "/single/path"),
            make_session("s2", "/single/path"),
            make_session("s3", "/single/path"),
        ];
        let paths = distinct_project_paths(&sessions);
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0], "/single/path");
    }
}
