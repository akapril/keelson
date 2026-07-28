// commands/sessions.rs — 会话相关 Tauri 命令（Task 16）
// 职责：从 AppState 中读取缓存会话、调用 Tantivy 搜索、读取时间轴等。
// 所有命令均为薄包装层，不含任何业务逻辑。

use crate::AppState;
use crate::models::{FileChange, PlannedTask, Session, TimelineMessage};
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
// Core 函数（不依赖 Tauri State，可被 gateway API handler 复用）
// ─────────────────────────────────────────────────────────────

/// 从 AppState 中读取缓存的全量会话列表。
///
/// 此函数是 `sessions_list` Tauri 命令与 `/api/sessions_list` gateway handler 的共同核心，
/// 避免在两处重复读锁逻辑。两条路径均读同一 `Arc<Mutex<Vec<Session>>>`，无需额外同步。
pub fn list_core(sessions: &parking_lot::Mutex<Vec<Session>>) -> Vec<Session> {
    sessions.lock().clone()
}

// ─────────────────────────────────────────────────────────────
// Tauri 命令
// ─────────────────────────────────────────────────────────────

/// 返回缓存的全量会话列表（由启动扫描 + Watcher 维护）。
#[tauri::command]
pub fn sessions_list(state: State<AppState>) -> Vec<Session> {
    list_core(&state.sessions)
}

/// 全文搜索会话，最多返回 SEARCH_LIMIT 条结果。
/// 若 Tantivy 索引尚未就绪，返回空列表（非致命）。
/// async：Tantivy 检索移出主线程（Tauri 同步命令跑主线程会冻 UI）。始终 Ok。
#[tauri::command]
pub async fn sessions_search(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<SessionHit>, String> {
    let hits = {
        let guard = state.index.lock();
        match guard.as_ref() {
            Some(idx) => crate::search::session_backend::search(idx, &query, SEARCH_LIMIT),
            // 索引未就绪（初始化中或构建失败）：静默返回空
            None => Vec::new(),
        }
    };
    Ok(hits)
}

/// 读取指定会话的时间轴消息列表（详情页用）。若 provider 不存在，返回空列表。
/// async：读+解析整个会话 JSONL 是阻塞 IO，改 async 移出主线程避免选中会话时冻 UI。始终 Ok。
#[tauri::command]
pub async fn sessions_timeline(
    provider: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<TimelineMessage>, String> {
    Ok(match state.reg.by_id(&provider) {
        Some(p) => p.read_timeline(&session_id),
        None => {
            eprintln!("[rework] sessions_timeline: 未知 provider '{provider}'");
            Vec::new()
        }
    })
}

/// 返回指定会话改动的文件列表（从转录里的 Write/Edit/MultiEdit 还原，含未提交改动）。
/// v1 仅 Claude（转录带结构化 tool_use）；其它 provider 返回空。
/// async + spawn_blocking：解析转录移出主线程。
#[tauri::command]
pub async fn session_file_changes(provider: String, session_id: String) -> Vec<FileChange> {
    tokio::task::spawn_blocking(move || {
        if provider == "claude" {
            crate::providers::claude::read_claude_file_changes(&session_id)
        } else {
            // Codex 的文件改动走 apply_patch/shell，结构不同，v1 暂不支持
            Vec::new()
        }
    })
    .await
    .unwrap_or_default()
}

/// 返回某会话「规划的任务」，供同步到看板并跟随进度：
/// - Claude：`~/.claude/tasks/<session>/` 的 TaskCreate/TaskUpdate 落盘状态；
/// - Codex：转录里最后一次 `update_plan` 的 plan 步骤。
/// async + spawn_blocking：读任务文件/转录移出主线程。
#[tauri::command]
pub async fn session_tasks(provider: String, session_id: String) -> Vec<PlannedTask> {
    tokio::task::spawn_blocking(move || match provider.as_str() {
        "claude" => crate::providers::claude::read_claude_session_tasks(&session_id),
        "codex" => crate::providers::codex::read_codex_session_tasks(&session_id),
        _ => Vec::new(),
    })
    .await
    .unwrap_or_default()
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
/// async + spawn_blocking：git_log 子进程 + 关联判定移出主线程。始终 Ok。
#[tauri::command]
pub async fn session_commits(
    session_id: String,
    provider: String,
    state: State<'_, AppState>,
) -> Result<Vec<crate::commands::git::CorrelatedCommit>, String> {
    // 取该会话的仓库路径与起止时间（in-memory，快）
    let sess = {
        let guard = state.sessions.lock();
        guard
            .iter()
            .find(|s| s.session_id == session_id && s.provider == provider)
            .cloned()
    };
    let Some(sess) = sess else {
        return Ok(Vec::new());
    };
    let result = tokio::task::spawn_blocking(move || {
        // 取数下界放宽到 created - grace：既覆盖时间窗候选，也让「略早于会话创建但 trailer 命中」
        // 的提交进入 correlate（避免 git --since 把精确关联先于 trailer 判据切掉）。correlate 再定性。
        let since = (sess.created_at - chrono::Duration::seconds(COMMIT_GRACE_SECS)).to_rfc3339();
        let commits =
            crate::commands::git::git_log_impl(&sess.project_path, Some(since), None, 500);
        crate::commands::git::correlate_session_commits(
            sess.created_at,
            sess.updated_at,
            &session_id,
            commits,
            COMMIT_GRACE_SECS,
        )
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(result)
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
            by_model: Default::default(),
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
