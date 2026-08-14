//! agent 执行内核：建 run → worktree → prompt → run_cli_stream → 超时 → 判定 → 写回。
use crate::agent::{outcome::{decide_outcome, Outcome}, prompt::build_task_prompt, worktree};
use crate::pb::client::PbClient;
use serde_json::json;
use std::path::Path;
use std::time::Duration;

/// 单次 agent 运行最长时限（秒）。超时 kill 子进程 → 受阻。
pub const AGENT_TIMEOUT_SECS: u64 = 1800;
/// run 日志尾部最多保留字节（超出截头保尾）。
pub const LOG_TAIL_MAX: usize = 65536;

/// 看板 provider id → run_cli_stream 的 CLI provider id。
/// P1 仅支持 claude/codex（官方 headless resume 一致的一次性 print/exec 模式）。
pub fn agent_run_provider_id(provider: &str) -> Option<&'static str> {
    match provider {
        "claude" => Some("claude-cli"),
        "codex"  => Some("codex-cli"),
        _        => None,
    }
}

/// 从 PbClient 取单条记录的某字段（用 list + filter id 实现；返回 JSON）。
async fn get_one(
    client: &PbClient,
    coll: &str,
    id: &str,
    fields: &str,
) -> Result<serde_json::Value, String> {
    // 转义 id 中的双引号，防止注入
    let filter = format!("id = \"{}\"", id.replace('"', ""));
    let rows = client.list(coll, &filter, fields).await.map_err(|e| e.to_string())?;
    rows.into_iter().next().ok_or_else(|| format!("{coll} 无记录 {id}"))
}

/// 截尾：保留末 LOG_TAIL_MAX 字节 + 前缀省略标记。
fn tail(s: &str) -> String {
    if s.len() <= LOG_TAIL_MAX {
        return s.to_string();
    }
    // 从字节边界截断（确保 UTF-8 合法）
    let start = s.len() - LOG_TAIL_MAX;
    // 向前找最近的 UTF-8 字符边界
    let start = (start..=s.len()).find(|&i| s.is_char_boundary(i)).unwrap_or(s.len());
    format!("…(截断)\n{}", &s[start..])
}

/// 执行内核：见模块文档。返回 agent_run id。on_line 用于把日志实时推给前端。
pub async fn execute_task_with_agent(
    client: &PbClient,
    owner_id: &str,
    task_id: &str,
    provider: &str,
    mut on_line: impl FnMut(String),
) -> Result<String, String> {
    // 0) provider 支持校验
    let cli_provider = agent_run_provider_id(provider)
        .ok_or_else(|| format!("P1 暂不支持 provider：{provider}（仅 claude/codex）"))?;

    // 1) 读任务 + 项目（repo_path/name/title/description）
    let task = get_one(client, "board_tasks", task_id, "id,title,description,project").await?;
    let project_id = task["project"].as_str().unwrap_or_default().to_string();
    let project = get_one(client, "board_projects", &project_id, "id,name,repo_path").await?;
    let repo = project["repo_path"].as_str().unwrap_or_default().to_string();
    if repo.trim().is_empty() {
        return Err("项目未设置 repo_path，无法派 agent".into());
    }
    let repo_path = Path::new(&repo);
    let title  = task["title"].as_str().unwrap_or_default().to_string();
    let desc   = task["description"].as_str().unwrap_or_default().to_string();
    let pname  = project["name"].as_str().unwrap_or_default().to_string();

    // 2) 建 running run 记录（先持久化，保证即便后续失败也有记录可查）
    let branch = worktree::branch_name(task_id);
    let run = client
        .create("agent_runs", &json!({
            "owner":    owner_id,
            "task":     task_id,
            "project":  project_id,
            "provider": provider,
            "status":   "running",
            "branch":   branch,
        }))
        .await
        .map_err(|e| e.to_string())?;
    let run_id = run["id"].as_str().unwrap_or_default().to_string();

    // 3) 建 worktree（失败 → run=blocked，仍返 run_id）
    let wt = match worktree::add_worktree(repo_path, task_id) {
        Ok(p) => p,
        Err(e) => {
            let _ = client
                .patch("agent_runs", &run_id, &json!({
                    "status":  "blocked",
                    "blocker": format!("worktree 建立失败：{e}"),
                }))
                .await;
            return Ok(run_id);
        }
    };
    // 记录 worktree 路径（方便 UI 展示/后续清理）
    let _ = client
        .patch("agent_runs", &run_id, &json!({ "worktree_path": wt.to_string_lossy() }))
        .await;

    // 4) 组 prompt + 跑 CLI（30min 超时，流式累日志）
    let prompt = build_task_prompt(&title, &desc, &pname, task_id);
    let msgs = vec![crate::commands::ai::ChatMessage {
        role:    "user".into(),
        content: prompt,
    }];
    let mut log = String::new();
    let wt_str = wt.to_string_lossy().to_string();

    // ⚠ P2 deferred：run_cli_stream 内部 build_process 未设 kill_on_drop(true)；
    //   timeout 超时 drop future 后子进程句柄随之 drop，但实际 kill 是否触发视平台而定。
    //   若子进程未被杀死，将在后台持续跑至自然退出。P2 应对 timeout 场景补显式 kill。
    let run_fut = crate::commands::cli::run_cli_stream(
        cli_provider,
        None,
        Some(&wt_str),
        &msgs,
        true,
        |piece| {
            log.push_str(&piece);
            on_line(piece);
        },
    );
    let result = tokio::time::timeout(Duration::from_secs(AGENT_TIMEOUT_SECS), run_fut).await;

    // 5) 判定结果
    let timed_out = result.is_err();
    let exit_ok   = matches!(&result, Ok(Ok(())));
    let has_diff  = worktree::has_diff(&wt).unwrap_or(false);
    let stat      = worktree::diff_stat(&wt).unwrap_or_default();

    let oc = if timed_out {
        Outcome::Blocked { reason: format!("超时（>{AGENT_TIMEOUT_SECS}s）已终止") }
    } else if let Ok(Err(e)) = &result {
        Outcome::Blocked { reason: format!("CLI 执行失败：{e}") }
    } else {
        decide_outcome(if exit_ok { Some(0) } else { None }, has_diff, None)
    };

    // 6) 写回 run（状态 + 产物摘要）
    let patch = match oc {
        Outcome::Review { no_change } => json!({
            "status":    "review",
            "no_change": no_change,
            "exit_code": 0,
            "diff_stat": stat,
            "log_tail":  tail(&log),
        }),
        Outcome::Blocked { reason } => json!({
            "status":   "blocked",
            "blocker":  reason,
            "log_tail": tail(&log),
        }),
    };
    let _ = client.patch("agent_runs", &run_id, &patch).await;
    Ok(run_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_supported_providers() {
        assert_eq!(agent_run_provider_id("claude"), Some("claude-cli"));
        assert_eq!(agent_run_provider_id("codex"),  Some("codex-cli"));
        assert_eq!(agent_run_provider_id("gemini"), None);
    }

    #[test]
    fn tail_short_string_unchanged() {
        let s = "hello";
        assert_eq!(tail(s), s);
    }

    #[test]
    fn tail_long_string_truncated() {
        // 构造超过 LOG_TAIL_MAX 的字符串，验证截尾行为
        let s = "a".repeat(LOG_TAIL_MAX + 100);
        let t = tail(&s);
        assert!(t.starts_with("…(截断)"));
        assert!(t.len() <= LOG_TAIL_MAX + 20); // 前缀 + 保留尾部
    }
}
