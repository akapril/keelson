//! agent 队列 worker：轮询「已入队」任务 → 受并发约束派发 → 复用执行内核。
//! pick_eligible 是纯函数（CI 单测）；轮询/wiring 见 start_worker/poll_once。
use std::collections::{HashMap, HashSet};
use crate::pb::client::PbClient;
use crate::AppState;
use serde_json::json;
use std::time::Duration;
use tauri::{Emitter, Manager};

/// 全局并发兜底上限（防失控；真正限流靠 per-agent max_concurrent）。
pub const AGENT_CONCURRENCY_GLOBAL_CAP: usize = 8;
/// worker 轮询间隔（秒）。
pub const WORKER_POLL_SECS: u64 = 5;

/// 一条候选入队任务（含分组维度，供按 agent 并发计算）。
#[derive(Clone, Debug, PartialEq)]
pub struct EnqueuedTask {
    pub task_id: String,
    /// 传给 executor 的 agent_ref（agent_id 优先，否则 provider）。
    pub agent_ref: String,
    /// 并发分组键：agent_id 非空则用之，否则用 "provider:<name>"（回退任务各自成组）。
    pub group_key: String,
    /// 该组并发上限（agent 的 max_concurrent，或默认 DEFAULT_MAX_CONCURRENT）。
    pub max_concurrent: u64,
}

/// 按 agent 分组计槽挑本轮可派任务：
/// - 每个 group 已跑数（running_by_group）+ 本轮已挑数 < 该 group 的 max_concurrent；
/// - 且总数（global_running + 本轮已挑）< global_cap（兜底防失控）；
/// 保持输入顺序。
pub fn pick_eligible(
    candidates: &[EnqueuedTask],
    running_by_group: &HashMap<String, usize>,
    global_running: usize,
    global_cap: usize,
) -> Vec<EnqueuedTask> {
    let mut out: Vec<EnqueuedTask> = Vec::new();
    // 本轮各组已挑计数（叠加到 running_by_group 之上）
    let mut picked_by_group: HashMap<String, usize> = HashMap::new();
    for t in candidates {
        // 全局兜底：总在跑 + 本轮已派 >= 上限则停止
        if global_running + out.len() >= global_cap {
            break;
        }
        // 该组已跑数（running）+ 本轮已挑数
        let already = running_by_group.get(&t.group_key).copied().unwrap_or(0)
            + picked_by_group.get(&t.group_key).copied().unwrap_or(0);
        // max_concurrent == 0 视为未设，用默认值
        let cap = if t.max_concurrent == 0 {
            crate::agent::resolve::DEFAULT_MAX_CONCURRENT
        } else {
            t.max_concurrent
        };
        if (already as u64) >= cap {
            // 该 group 槽位已满，跳过（继续看其他 group 的候选）
            continue;
        }
        *picked_by_group.entry(t.group_key.clone()).or_insert(0) += 1;
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
/// 每条恢复记录同时写一条决策通知（bell），与 executor 各终态点保持一致。
pub async fn recover_interrupted_runs(client: &PbClient) {
    // 同时取 owner/task/provider/agent，用于后续写决策通知
    let rows = match client
        .list("agent_runs", "status = \"running\" && deleted_at = \"\"", "id,owner,task,provider,agent")
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[keelson] agent 启动恢复查询失败（非致命）: {e}");
            return;
        }
    };
    const RESTART_BLOCKER: &str = "应用重启中断——请重新派发或打回";
    for row in rows {
        let Some(id) = row["id"].as_str() else { continue };
        // 标 blocked
        let _ = client
            .patch("agent_runs", id, &json!({
                "status":  "blocked",
                "blocker": RESTART_BLOCKER,
            }))
            .await;

        // 受阻 → 写决策通知（bell），与 executor 各终态点一致
        let owner = row["owner"].as_str().unwrap_or_default().to_string();
        if owner.is_empty() {
            // owner 是通知必填字段，缺失时跳过通知但保留 patch
            continue;
        }
        let task = row["task"].as_str().unwrap_or_default().to_string();
        let provider = row["provider"].as_str().unwrap_or_default().to_string();
        let agent = row["agent"].as_str().unwrap_or_default().to_string();

        // agent_id 非空则用 agent_id 解析展示名，否则回退 provider
        let agent_ref = if !agent.is_empty() { &agent } else { &provider };
        let resolved = crate::agent::resolve::resolve_agent(client, agent_ref).await;

        // 尽量取任务标题；查询失败则用 task id（非致命）
        let task_title = if task.is_empty() {
            task.clone()
        } else {
            let filter = format!("id = \"{}\"", task.replace('"', ""));
            match client.list("board_tasks", &filter, "id,title").await {
                Ok(rows) => rows
                    .into_iter()
                    .next()
                    .and_then(|r| r["title"].as_str().map(|s| s.to_string()))
                    .unwrap_or_else(|| task.clone()),
                Err(_) => task.clone(),
            }
        };

        crate::agent::notify::notify_decision(
            client,
            &owner,
            "blocked",
            &resolved.display_name,
            &task_title,
            RESTART_BLOCKER,
        )
        .await;
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

/// 单轮轮询：拉候选入队任务 + 当前 running → pick_eligible(按 agent 分组) → 清 enqueued → 后台执行。
async fn poll_once(app: &tauri::AppHandle) -> Result<(), String> {
    // auth 未就绪则跳过本轮
    let (client, owner_id) = match worker_client(app) {
        Some(c) => c,
        None => return Ok(()),
    };

    // 1) 拉候选：已入队 + (有 agent_id 或有 provider) + 未软删
    //    同时取 agent_id 字段——Task 1 已加，S2 起用于分组和执行路由
    let cand_rows = client
        .list(
            "board_tasks",
            "agent_enqueued = true && (agent_id != \"\" || agent_provider != \"\") && deleted_at = \"\"",
            "id,agent_id,agent_provider",
        )
        .await
        .map_err(|e| e.to_string())?;

    if cand_rows.is_empty() {
        return Ok(());
    }

    // 2) 拉活跃 agent_profiles 的 id→max_concurrent 映射
    let profiles = client
        .list("agent_profiles", "deleted_at = \"\"", "id,max_concurrent")
        .await
        .map_err(|e| e.to_string())?;
    let cap_of: HashMap<String, u64> = profiles
        .into_iter()
        .filter_map(|p| {
            let id = p["id"].as_str()?.to_string();
            let cap = p["max_concurrent"]
                .as_f64()
                .map(|n| n as u64)
                .filter(|&n| n > 0)
                .unwrap_or(crate::agent::resolve::DEFAULT_MAX_CONCURRENT);
            Some((id, cap))
        })
        .collect();

    // 3) 组装候选列表（含分组键和上限）
    //    agent_id 非空 → group_key=agent_id，agent_ref=agent_id；
    //    否则 → group_key="provider:<name>"，agent_ref=provider（回退兼容）。
    let candidates: Vec<EnqueuedTask> = cand_rows
        .into_iter()
        .filter_map(|r| {
            let id = r["id"].as_str()?.to_string();
            let aid = r["agent_id"].as_str().unwrap_or_default().to_string();
            let prov = r["agent_provider"].as_str().unwrap_or_default().to_string();
            let (agent_ref, group_key, cap) = if !aid.is_empty() {
                // agent_id 路径：cap 从 profiles 取，未命中则用默认
                let cap = cap_of
                    .get(&aid)
                    .copied()
                    .unwrap_or(crate::agent::resolve::DEFAULT_MAX_CONCURRENT);
                (aid.clone(), aid, cap)
            } else {
                // provider 回退路径：各 provider 各成一组
                (prov.clone(), format!("provider:{prov}"), crate::agent::resolve::DEFAULT_MAX_CONCURRENT)
            };
            Some(EnqueuedTask { task_id: id, agent_ref, group_key, max_concurrent: cap })
        })
        .collect();

    // 4) 拉当前「非终态」run，构造：
    //    - busy_ids：running/review/blocked 全部任务 id（防自动重派，S1 逻辑保留）；
    //    - running_by_group：仅 status=running 的 run，按 agent/provider 分组计数（占槽位）；
    //    - global_running：status=running 的 run 总数。
    //    注意 running vs busy 的区分：
    //      busy = 任何非终态（含 review/blocked）→ 排除候选，避免覆盖人工决策；
    //      running = 真正运行中 → 占用并发槽位，用于 pick_eligible 计算。
    let run_rows = client
        .list(
            "agent_runs",
            "(status = \"running\" || status = \"review\" || status = \"blocked\") && deleted_at = \"\"",
            "id,task,status,agent,provider",
        )
        .await
        .map_err(|e| e.to_string())?;

    let mut busy_ids: HashSet<String> = HashSet::new();   // 非终态任务 id（排候选）
    let mut running_by_group: HashMap<String, usize> = HashMap::new(); // 仅 running，按组计数
    let mut global_running: usize = 0;

    for r in run_rows {
        if let Some(task_id) = r["task"].as_str() {
            busy_ids.insert(task_id.to_string());
            if r["status"].as_str() == Some("running") {
                global_running += 1;
                // group 优先用 run.agent（agent_id），否则回退 "provider:<run.provider>"
                let run_agent = r["agent"].as_str().unwrap_or_default();
                let run_prov = r["provider"].as_str().unwrap_or_default();
                let group = if !run_agent.is_empty() {
                    run_agent.to_string()
                } else {
                    format!("provider:{run_prov}")
                };
                *running_by_group.entry(group).or_insert(0) += 1;
            }
        }
    }

    // 5) 先剔除 busy 候选（S1 防自动重派），再按 agent 分组计槽选本轮任务
    let mut filtered_candidates = candidates.clone();
    filtered_candidates.retain(|c| !busy_ids.contains(&c.task_id));
    let picked = pick_eligible(
        &filtered_candidates,
        &running_by_group,
        global_running,
        AGENT_CONCURRENCY_GLOBAL_CAP,
    );

    // 6) 处理 provider 回退路径中 provider 不受支持的候选（清 enqueued，避免死循环领取）
    //    仅针对 group_key 以 "provider:" 开头的候选（agent_id 路径由 resolve 统一处理）。
    for c in &candidates {
        if c.group_key.starts_with("provider:") {
            let provider_name = &c.agent_ref; // 回退路径 agent_ref == provider name
            if crate::agent::executor::agent_run_provider_id(provider_name).is_none() {
                let _ = client
                    .patch("board_tasks", &c.task_id, &json!({ "agent_enqueued": false }))
                    .await;
            }
        }
    }

    // 7) 派发：先清 enqueued（防重领），再后台执行；执行内核会同步建 running run
    for t in picked {
        let _ = client
            .patch("board_tasks", &t.task_id, &json!({ "agent_enqueued": false }))
            .await;

        let client2 = client.clone();
        let owner2 = owner_id.clone();
        let app2 = app.clone();
        let task_id = t.task_id.clone();
        let agent_ref = t.agent_ref.clone();
        let app_log = app2.clone();
        let task_log = task_id.clone();
        tauri::async_runtime::spawn(async move {
            // 复用执行内核；传 agent_ref（agent_id 优先，否则 provider 回退）。
            // 关键修复：此前 |_piece|{} 把日志全丢了 → worker/MCP 派发的 run 在面板上永久
            // 显示「执行中，等待输出…」(实质在撒谎)。改为 emit 全局 agent-run-log 事件，
            // 前端全局桥接 append 到日志 store，让在途 run 真的看得见。
            let _ = crate::agent::executor::execute_task_with_agent(
                &client2,
                &owner2,
                &task_id,
                &agent_ref,
                move |piece| {
                    let _ = app_log.emit(
                        "agent-run-log",
                        json!({ "task_id": &task_log, "delta": piece }),
                    );
                },
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

    fn task(id: &str, group: &str, cap: u64) -> EnqueuedTask {
        EnqueuedTask {
            task_id: id.into(),
            agent_ref: "claude".into(),
            group_key: group.into(),
            max_concurrent: cap,
        }
    }

    #[test]
    fn empty_candidates_yields_empty() {
        let running = std::collections::HashMap::new();
        assert!(pick_eligible(&[], &running, 0, 1).is_empty());
    }

    #[test]
    fn per_agent_cap_limits_same_group() {
        // 同一 agent(group=A) cap=1，两个候选 → 只派 1 个
        let running = std::collections::HashMap::new();
        let cands = vec![task("t1", "A", 1), task("t2", "A", 1)];
        let picked = pick_eligible(&cands, &running, 0, 8);
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].task_id, "t1");
    }

    #[test]
    fn different_agents_run_in_parallel() {
        // 两个不同 agent 各 cap=1，全局兜底 8 → 都派
        let running = std::collections::HashMap::new();
        let cands = vec![task("t1", "A", 1), task("t2", "B", 1)];
        let picked = pick_eligible(&cands, &running, 0, 8);
        assert_eq!(picked.len(), 2);
    }

    #[test]
    fn respects_existing_running_in_group() {
        // group A 已有 1 个在跑，cap=1 → 不再派 A；B 可派
        let mut running = std::collections::HashMap::new();
        running.insert("A".to_string(), 1usize);
        let cands = vec![task("t1", "A", 1), task("t2", "B", 1)];
        let picked = pick_eligible(&cands, &running, 1, 8);
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].group_key, "B");
    }

    #[test]
    fn global_cap_bounds_total() {
        // 全局兜底 1：即便两个不同 agent 也只派 1
        let running = std::collections::HashMap::new();
        let cands = vec![task("t1", "A", 5), task("t2", "B", 5)];
        let picked = pick_eligible(&cands, &running, 0, 1);
        assert_eq!(picked.len(), 1);
    }
}
