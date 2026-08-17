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

/// 读取某 run 记录的 task + project.repo_path + base_branch，供命令层 merge/discard 使用。
/// 返回 (task_id, repo_path, base_branch)。
/// base_branch 为建 worktree 时持久化的值，merge 时必须用此值，禁止重新求值（防漂移）。
pub async fn executor_get_run(
    client: &PbClient,
    run_id: &str,
) -> Result<(String, String, String), String> {
    // 读 agent_runs 取 task + project + base_branch 字段
    let run = get_one(client, "agent_runs", run_id, "id,task,project,base_branch").await?;
    let task_id = run["task"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("agent_run {run_id} 缺少 task 字段"))?
        .to_string();
    let project_id = run["project"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("agent_run {run_id} 缺少 project 字段"))?
        .to_string();
    // base_branch 可能为空（旧记录兼容：回退到空串，调用层自行处理）
    let base_branch = run["base_branch"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    // 读 board_projects 取 repo_path
    let project = get_one(client, "board_projects", &project_id, "id,repo_path").await?;
    let repo_path = project["repo_path"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| format!("board_projects {project_id} 缺少 repo_path"))?
        .to_string();
    Ok((task_id, repo_path, base_branch))
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
    // 校验目录存在且是 git 仓库（agent 需要在 git 仓库里建隔离工作树）
    if !repo_path.exists() {
        return Err(format!("项目目录不存在：{repo}。请检查该项目的 repo_path。"));
    }
    if !worktree::is_git_repo(repo_path) {
        return Err(format!(
            "项目目录不是 git 仓库：{repo}。agent 需要 git 仓库来建隔离工作树——请先在该目录执行 `git init` 并提交一次，或把项目的 repo_path 指向一个 git 仓库。"
        ));
    }
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
    // add_worktree 返回 (worktree路径, 实际 base 分支名)，base 须持久化防止漂移
    let (wt, base_branch) = match worktree::add_worktree(repo_path, task_id) {
        Ok(pair) => pair,
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
    // 记录 worktree 路径 + base_branch（base_branch 在合并时必须用此值，禁止重新求值）
    let _ = client
        .patch("agent_runs", &run_id, &json!({
            "worktree_path": wt.to_string_lossy(),
            "base_branch":   base_branch,
        }))
        .await;

    // 4) 组 prompt + 跑 CLI（30min 超时，流式累日志）
    let prompt = build_task_prompt(&title, &desc, &pname, task_id);
    let msgs = vec![crate::commands::ai::ChatMessage {
        role:    "user".into(),
        content: prompt,
    }];
    let mut log = String::new();
    let wt_str = wt.to_string_lossy().to_string();

    // build_process 已设 kill_on_drop(true)：超时 timeout drop 掉 run_fut 后，
    // 其栈内持有的子进程 Child 随之 drop 并被 kill，不留后台孤儿。
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
