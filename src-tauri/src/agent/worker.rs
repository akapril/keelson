//! agent 队列 worker：轮询「已入队」任务 → 受并发约束派发 → 复用执行内核。
//! 本文件的 pick_eligible 是纯函数（CI 单测）；轮询/wiring 见 start_worker/poll_once。
use std::collections::HashSet;
use crate::pb::client::PbClient;
use crate::AppState;
use serde_json::json;
use std::time::Duration;
use tauri::{Emitter, Manager};

/// 同时最多并发执行的 agent 数（S1 默认 1；后续可提为配置）。
pub const AGENT_CONCURRENCY: usize = 1;
/// worker 轮询间隔（秒）。
pub const WORKER_POLL_SECS: u64 = 5;

/// 一条候选入队任务的精简视图（纯函数输入，便于单测）。
#[derive(Clone, Debug, PartialEq)]
pub struct EnqueuedTask {
    pub task_id: String,
    pub provider: String,
}

/// 从候选入队任务中挑出本轮可派发的任务：
/// - 跳过已有 running run 的任务（running_task_ids）；
/// - 跳过 provider 不受支持的任务（agent_run_provider_id 返 None）；
/// - 至多派发 (concurrency - 当前 running 数) 个，且不为负；
/// 返回应立即派发的任务（保持输入顺序）。
pub fn pick_eligible(
    candidates: &[EnqueuedTask],
    running_task_ids: &HashSet<String>,
    concurrency: usize,
) -> Vec<EnqueuedTask> {
    // 剩余可用并发槽位（running 数已占用；不足则为 0）
    let slots = concurrency.saturating_sub(running_task_ids.len());
    let mut out = Vec::new();
    for t in candidates {
        if out.len() >= slots {
            break;
        }
        // 已在跑的任务不重复派发
        if running_task_ids.contains(&t.task_id) {
            continue;
        }
        // provider 不受支持则跳过（由调用方清 enqueued，避免死循环领取）
        if crate::agent::executor::agent_run_provider_id(&t.provider).is_none() {
            continue;
        }
        out.push(t.clone());
    }
    out
}

/// 从 AppState 读取 bootstrap auth，构造 (PbClient, owner_id)。auth 未就绪返回 None。
/// 作用域内克隆字符串，避免持锁跨 await。
fn worker_client(app: &tauri::AppHandle) -> Option<(PbClient, String)> {
    let state = app.state::<AppState>();
    let g = state.auth.lock();
    let a = g.as_ref()?;
    Some((PbClient::new(&a.base_url, &a.token), a.user_id.clone()))
}

/// 启动恢复：应用重启会中断进行中的 run，把遗留 status=running 的记录标 blocked，
/// worktree 保留待人处理，避免「卡在 running」的僵尸占用并发槽。
pub async fn recover_interrupted_runs(client: &PbClient) {
    let rows = match client
        .list("agent_runs", "status = \"running\" && deleted_at = \"\"", "id")
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[keelson] agent 启动恢复查询失败（非致命）: {e}");
            return;
        }
    };
    for row in rows {
        if let Some(id) = row["id"].as_str() {
            let _ = client
                .patch("agent_runs", id, &json!({
                    "status":  "blocked",
                    "blocker": "应用重启中断——请重新派发或打回",
                }))
                .await;
        }
    }
}

/// 启动 worker：进程内 tokio 轮询循环。每 WORKER_POLL_SECS 秒调一次 poll_once。
/// auth 未就绪的轮次自动跳过（poll_once 内部处理）。
pub fn start_worker(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(WORKER_POLL_SECS)).await;
            if let Err(e) = poll_once(&app).await {
                eprintln!("[keelson] agent worker 轮询失败（非致命）: {e}");
            }
        }
    });
}

/// 单轮轮询：拉候选入队任务 + 当前 running → pick_eligible → 清 enqueued → 后台执行。
async fn poll_once(app: &tauri::AppHandle) -> Result<(), String> {
    // auth 未就绪则跳过本轮
    let (client, owner_id) = match worker_client(app) {
        Some(c) => c,
        None => return Ok(()),
    };

    // 1) 拉候选：已入队 + 有负责人 + 未软删
    let cand_rows = client
        .list(
            "board_tasks",
            "agent_enqueued = true && agent_provider != \"\" && deleted_at = \"\"",
            "id,agent_provider",
        )
        .await
        .map_err(|e| e.to_string())?;
    let candidates: Vec<EnqueuedTask> = cand_rows
        .into_iter()
        .filter_map(|r| {
            let id = r["id"].as_str()?.to_string();
            let provider = r["agent_provider"].as_str().unwrap_or_default().to_string();
            Some(EnqueuedTask { task_id: id, provider })
        })
        .collect();
    if candidates.is_empty() {
        return Ok(());
    }

    // 2) 拉当前 running 的任务 id 集
    let run_rows = client
        .list("agent_runs", "status = \"running\" && deleted_at = \"\"", "id,task")
        .await
        .map_err(|e| e.to_string())?;
    let running: HashSet<String> = run_rows
        .into_iter()
        .filter_map(|r| r["task"].as_str().map(|s| s.to_string()))
        .collect();

    // 3) 决策本轮派发
    let picked = pick_eligible(&candidates, &running, AGENT_CONCURRENCY);

    // 4) 处理 provider 不受支持的候选（清 enqueued，避免死循环领取）
    for c in &candidates {
        if crate::agent::executor::agent_run_provider_id(&c.provider).is_none() {
            let _ = client
                .patch("board_tasks", &c.task_id, &json!({ "agent_enqueued": false }))
                .await;
        }
    }

    // 5) 派发：先清 enqueued（防重领），再后台执行；执行内核会同步建 running run
    for t in picked {
        let _ = client
            .patch("board_tasks", &t.task_id, &json!({ "agent_enqueued": false }))
            .await;

        let client2 = client.clone();
        let owner2 = owner_id.clone();
        let app2 = app.clone();
        let task_id = t.task_id.clone();
        let provider = t.provider.clone();
        tauri::async_runtime::spawn(async move {
            // 复用执行内核；S1 徽标只需状态变化，不逐字广播日志（面板打开时另有实时流）
            let _ = crate::agent::executor::execute_task_with_agent(
                &client2, &owner2, &task_id, &provider, |_piece| {},
            )
            .await;
            // 完成（review/blocked）后通知前端刷新该任务徽标
            let _ = app2.emit("agent-run-changed", task_id);
        });
        // 派发瞬间也通知一次（running run 已建，前端可立即显示「执行中」）
        let _ = app.emit("agent-run-changed", t.task_id);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(id: &str, provider: &str) -> EnqueuedTask {
        EnqueuedTask { task_id: id.into(), provider: provider.into() }
    }

    #[test]
    fn empty_candidates_yields_empty() {
        let running = HashSet::new();
        assert!(pick_eligible(&[], &running, 1).is_empty());
    }

    #[test]
    fn concurrency_one_no_running_picks_first_only() {
        let running = HashSet::new();
        let cands = vec![task("a", "claude"), task("b", "codex")];
        let picked = pick_eligible(&cands, &running, 1);
        assert_eq!(picked, vec![task("a", "claude")]);
    }

    #[test]
    fn skips_already_running_task() {
        let mut running = HashSet::new();
        running.insert("a".to_string());
        let cands = vec![task("a", "claude"), task("b", "codex")];
        // a 在跑 → running 占 1 槽，concurrency=2 → 只剩 1 槽给 b
        let picked = pick_eligible(&cands, &running, 2);
        assert_eq!(picked, vec![task("b", "codex")]);
    }

    #[test]
    fn full_concurrency_picks_nothing() {
        let mut running = HashSet::new();
        running.insert("x".to_string());
        let cands = vec![task("a", "claude")];
        assert!(pick_eligible(&cands, &running, 1).is_empty());
    }

    #[test]
    fn skips_unsupported_provider() {
        let running = HashSet::new();
        let cands = vec![task("a", "gemini"), task("b", "claude")];
        // gemini 不受支持被跳过，claude 入选
        let picked = pick_eligible(&cands, &running, 1);
        assert_eq!(picked, vec![task("b", "claude")]);
    }
}
