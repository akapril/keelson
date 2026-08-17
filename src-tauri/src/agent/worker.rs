//! agent 队列 worker：轮询「已入队」任务 → 受并发约束派发 → 复用执行内核。
//! 本文件的 pick_eligible 是纯函数（CI 单测）；轮询/wiring 见 start_worker/poll_once。
use std::collections::HashSet;

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
