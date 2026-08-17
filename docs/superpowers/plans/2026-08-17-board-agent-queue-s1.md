# 看板 = agent 队列（S1）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把看板从「手动即时跑一次 agent」升级为「指派即入队 → 后台 worker 自动领取执行」的工作队列（Multica 式指派即派发），并补齐 agent 执行 P1 的两处缺口（超时 kill、启动恢复）。

**Architecture:** 新增进程内 tokio 轮询 worker（`agent/worker.rs`）：每 5s 用 `PbClient` 拉「已入队且有负责人且无 running run」的任务，受并发常量（默认 1）约束，复用既有 `execute_task_with_agent` 在隔离 worktree 里跑，完成后 `emit` 事件让前端徽标刷新。前端「派 agent」下拉语义从「即时跑」改为「指派负责人（写 `agent_provider` + `agent_enqueued=true`）」。看板加「有 agent 参与」过滤开关。数据模型不变（`board_tasks.agent_provider/agent_enqueued` + `agent_runs` 已由 agent P1 迁移建好）。

**Tech Stack:** Rust / Tauri v2（`tauri::async_runtime::spawn`、`tauri::Emitter`）、tokio、PocketBase REST（`PbClient`）、React 19 + TypeScript、zustand（board store）、react-i18next、vitest。

设计依据：`docs/superpowers/specs/2026-08-17-board-agent-queue-s1-design.md`（已过审）。

## Global Constraints

- **复用 agent P1 内核，不重写业务**：`execute_task_with_agent` / `worktree` / `AgentRunPanel` / `agent-run-logs` / `agent-runs` 访问层 / board store `updateTask` 全复用。S1 只加 worker + 改指派语义 + kill 修复 + 启动恢复 + 过滤。
- **中文注释**：所有新增/修改代码的注释与日志用中文，解释意图。
- **不硬编码**：并发数、轮询间隔用命名常量（`AGENT_CONCURRENCY` / `WORKER_POLL_SECS`）。
- **store 写失败重抛 + toast**：前端调 `updateTask` 失败必须 toast 且不吞错（board store `updateTask` 已实现回滚+重抛）。
- **子进程 spawn 走 `crate::proc::hidden_*`**（防 Windows 闪窗）——已由 `build_process` 保证，勿绕过。
- **安全**：指派即跑靠 worktree 隔离 + 审查闸门兜底；并发默认 1；超时 kill；**绝不自动合并主干**（合并仍是人点「合并」触发 `agent_merge_run`）。
- **TDD**：纯函数（`pick_eligible` / `taskHasAgent`）先写失败测试再实现。Rust 集成靠 `cargo check` + CI（ubuntu `cargo test --lib`）；**Windows 本地 `cargo test` 报 0xc0000139（Tauri GUI DLL），只验编译**，纯函数 `#[cfg(test)]` 单测靠 CI 跑。
- **tsc 通过**：前端改动 `pnpm tsc --noEmit` 无错。
- **提交不加 `Co-Authored-By: Claude` 尾注**（keelson 开源署名整洁）。
- **git add 精确文件**：每个 Task 只 `git add` 该 Task 列出的确切文件，**严禁 `git add -A` / `git add .`**（工作区有未跟踪的 spec/plan 文档 + 私有 `docs/promotion/`，绝不可误提交）。

---

## File Structure

- `src/types/board.ts`（改）：`BoardTask` 加 `agent_provider?` / `agent_enqueued?` 字段。
- `src/features/board/agent-filter.ts`（新）：`taskHasAgent` 纯函数 + `AGENT_FILTER_PROVIDERS`（前端展示用支持集，从 TaskCard 迁出复用）。
- `src/features/board/agent-filter.test.ts`（新）：`taskHasAgent` 单测。
- `src-tauri/src/agent/worker.rs`（新）：`EnqueuedTask`、`pick_eligible`（纯函数 + 单测）、`AGENT_CONCURRENCY` / `WORKER_POLL_SECS`、`start_worker`、`poll_once`、`recover_interrupted_runs`。
- `src-tauri/src/agent/mod.rs`（改）：`pub mod worker;`。
- `src-tauri/src/commands/cli.rs`（改）：`build_process` 给子进程设 `kill_on_drop(true)`。
- `src-tauri/src/lib.rs`（改）：`setup_pocketbase` 内 auth 就绪后调 `recover_interrupted_runs` + `start_worker`。
- `src/features/board/TaskCard.tsx`（改）：「派 agent」下拉 → 「指派」语义（写 `agent_provider` + `agent_enqueued`）；已入队徽标；`listen("agent-run-changed")` 刷新徽标；复用 `agent-filter.ts` 的支持集。
- `src/features/board/KanbanBoard.tsx`（改）：工具条加「有 agent 参与」开关 + 过滤联动。
- `src/i18n/locales/zh/board.json` / `src/i18n/locales/en/board.json`（改）：指派 / 已入队 / 过滤文案。

---

## Task 1: BoardTask 加 agent 字段 + `taskHasAgent` 纯函数

给前端类型补上 P1 迁移已存在但 TS 侧尚未声明的两个字段，并实现看板「有 agent 参与」判定纯函数（TDD）。

**Files:**
- Modify: `src/types/board.ts:42-63`（`BoardTask` 接口）
- Create: `src/features/board/agent-filter.ts`
- Test: `src/features/board/agent-filter.test.ts`

**Interfaces:**
- Consumes: `BoardTask`（`@/types/board`）、`AgentRun`（`@/types/agent`）。
- Produces:
  - `BoardTask.agent_provider?: string`、`BoardTask.agent_enqueued?: boolean`
  - `AGENT_FILTER_PROVIDERS: Set<string>`（值 `new Set(["claude", "codex"])`，S1 支持集）
  - `taskHasAgent(task: BoardTask, latestRun: AgentRun | null): boolean` —— 任务有负责人（`agent_provider` 非空）或已入队（`agent_enqueued`）或有一条非终态 run（`running`/`review`/`blocked`）即为「有 agent 参与」。

- [ ] **Step 1: 写失败测试**

创建 `src/features/board/agent-filter.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { taskHasAgent } from "./agent-filter";
import type { BoardTask } from "@/types/board";
import type { AgentRun } from "@/types/agent";

// 构造最小 BoardTask（只填 taskHasAgent 关心的字段，其余用占位）
function mkTask(patch: Partial<BoardTask>): BoardTask {
  return {
    id: "t1",
    project: "p1",
    state: "s1",
    title: "任务",
    priority: "none",
    created_by: "u1",
    created: "",
    updated: "",
    ...patch,
  };
}

// 构造最小 AgentRun
function mkRun(status: AgentRun["status"]): AgentRun {
  return {
    id: "r1",
    task: "t1",
    project: "p1",
    provider: "claude",
    status,
    branch: "",
    worktree_path: "",
    blocker: "",
    no_change: false,
    diff_stat: "",
    log_tail: "",
    started: "",
    ended: "",
  };
}

describe("taskHasAgent", () => {
  it("无负责人、未入队、无 run → false", () => {
    expect(taskHasAgent(mkTask({}), null)).toBe(false);
  });

  it("有负责人（agent_provider 非空）→ true", () => {
    expect(taskHasAgent(mkTask({ agent_provider: "claude" }), null)).toBe(true);
  });

  it("已入队（agent_enqueued）→ true", () => {
    expect(taskHasAgent(mkTask({ agent_enqueued: true }), null)).toBe(true);
  });

  it("有 running run → true", () => {
    expect(taskHasAgent(mkTask({}), mkRun("running"))).toBe(true);
  });

  it("有 blocked run → true", () => {
    expect(taskHasAgent(mkTask({}), mkRun("blocked"))).toBe(true);
  });

  it("仅有终态 run（merged）且无负责人/未入队 → false", () => {
    expect(taskHasAgent(mkTask({}), mkRun("merged"))).toBe(false);
  });

  it("空字符串负责人不算有 agent → false", () => {
    expect(taskHasAgent(mkTask({ agent_provider: "" }), null)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/features/board/agent-filter.test.ts`
Expected: FAIL（`taskHasAgent` 未定义 / 模块不存在）

- [ ] **Step 3: `BoardTask` 加字段**

在 `src/types/board.ts` 的 `BoardTask` 接口内（`source_anchor?` 之后、`created` 之前）插入：

```ts
  /** agent 负责人 provider（claude/codex）；非空即已指派 agent（S1）。 */
  agent_provider?: string;
  /** 已入队待后台 worker 领取执行（S1）。worker 领取后清此标记。 */
  agent_enqueued?: boolean;
```

- [ ] **Step 4: 实现 `agent-filter.ts`**

创建 `src/features/board/agent-filter.ts`：

```ts
// 看板「有 agent 参与」判定（纯函数，可测）+ S1 支持的 provider 集合。
import type { BoardTask } from "@/types/board";
import type { AgentRun } from "@/types/agent";

// S1 阶段支持 Agent 自主执行的 provider 集合（TaskCard 下拉与看板过滤共用）。
export const AGENT_FILTER_PROVIDERS = new Set(["claude", "codex"]);

// 非终态 run 状态：这些状态说明 agent 仍在参与该任务（执行中/待审/受阻）。
const ACTIVE_RUN_STATUS = new Set(["running", "review", "blocked"]);

/**
 * 判断任务是否「有 agent 参与」：
 * - 有负责人（agent_provider 非空），或
 * - 已入队（agent_enqueued），或
 * - 最新 run 处于非终态（running/review/blocked）。
 * 仅有终态 run（merged/discarded）且无负责人/未入队 → 视为不再参与。
 */
export function taskHasAgent(task: BoardTask, latestRun: AgentRun | null): boolean {
  if (task.agent_provider && task.agent_provider.trim() !== "") return true;
  if (task.agent_enqueued) return true;
  if (latestRun && ACTIVE_RUN_STATUS.has(latestRun.status)) return true;
  return false;
}
```

- [ ] **Step 5: 运行测试确认通过 + tsc**

Run: `pnpm vitest run src/features/board/agent-filter.test.ts && pnpm tsc --noEmit`
Expected: PASS，tsc 无错。

- [ ] **Step 6: 提交**

```bash
git add src/types/board.ts src/features/board/agent-filter.ts src/features/board/agent-filter.test.ts
git commit -m "feat(board): 加 taskHasAgent 纯函数 + BoardTask agent 字段(S1)"
```

---

## Task 2: `pick_eligible` 纯函数（worker 派发决策）

worker 每轮的核心决策抽成纯函数：给定候选入队任务、正在跑的任务 id 集、并发上限，挑出本轮应派发的任务。Rust 单测（CI 跑）。

**Files:**
- Create: `src-tauri/src/agent/worker.rs`（本 Task 仅建纯函数 + 常量 + 单测；轮询/wiring 在 Task 3）
- Modify: `src-tauri/src/agent/mod.rs:5`（加 `pub mod worker;`）

**Interfaces:**
- Consumes: `crate::agent::executor::agent_run_provider_id`（判 provider 是否受支持）。
- Produces:
  - `pub const AGENT_CONCURRENCY: usize = 1;`
  - `pub const WORKER_POLL_SECS: u64 = 5;`
  - `pub struct EnqueuedTask { pub task_id: String, pub provider: String }`（`#[derive(Clone, Debug, PartialEq)]`）
  - `pub fn pick_eligible(candidates: &[EnqueuedTask], running_task_ids: &HashSet<String>, concurrency: usize) -> Vec<EnqueuedTask>`

- [ ] **Step 1: 建模块骨架 + 写失败测试**

在 `src-tauri/src/agent/mod.rs` 末尾加：

```rust
pub mod worker;
```

创建 `src-tauri/src/agent/worker.rs`（先只放常量 + 结构体 + 空实现 + 测试，让测试能编译并失败）：

```rust
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
```

- [ ] **Step 2: 运行测试确认通过（本机编译，CI 跑断言）**

Run（Windows 本机只验编译）: `cd src-tauri && cargo check`
Expected: 编译通过（`cargo test --lib` 在 Windows 报 0xc0000139，属预期；断言由 CI 验证）。
CI 上等价：`cargo test --lib agent::worker`。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/agent/mod.rs src-tauri/src/agent/worker.rs
git commit -m "feat(agent): pick_eligible 派发决策纯函数 + worker 常量(S1)"
```

---

## Task 3: worker 轮询循环 + 启动恢复 + wiring

在 Task 2 的 worker 模块里加轮询循环（拉候选 / 拉 running / `pick_eligible` / 清 enqueued / 后台执行 / emit 事件）与启动恢复函数，并在 `lib.rs` auth 就绪后启动。

**Files:**
- Modify: `src-tauri/src/agent/worker.rs`（加 `start_worker` / `poll_once` / `recover_interrupted_runs`）
- Modify: `src-tauri/src/lib.rs`（`setup_pocketbase` 内 auth 就绪后调用）

**Interfaces:**
- Consumes: `crate::pb::client::PbClient`（`list` / `patch`，均 async）、`crate::agent::executor::execute_task_with_agent`、`tauri::AppHandle` + `tauri::Emitter`、`crate::AppState`（读 `auth`）、`super::{EnqueuedTask, pick_eligible, AGENT_CONCURRENCY, WORKER_POLL_SECS}`。
- Produces:
  - `pub fn start_worker(app: tauri::AppHandle)` —— spawn 后台轮询任务（不阻塞）。
  - `pub async fn recover_interrupted_runs(client: &PbClient)` —— 把遗留 `status=running` 的 run 标 `blocked`。
  - 前端事件：`app.emit("agent-run-changed", task_id: String)`（Task 5 前端监听刷新徽标）。

- [ ] **Step 1: 在 `worker.rs` 加轮询 + 恢复实现**

在 `worker.rs` 顶部 `use` 区补：

```rust
use crate::pb::client::PbClient;
use crate::AppState;
use serde_json::json;
use std::time::Duration;
use tauri::{Emitter, Manager};
```

在 `pick_eligible` 之后、`#[cfg(test)]` 之前插入：

```rust
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
```

- [ ] **Step 2: 在 `lib.rs` auth 就绪后启动恢复 + worker**

在 `src-tauri/src/lib.rs` 的 `setup_pocketbase` 内，MCP server 启动块（`// 启动应用内 MCP server` 那段，约 697-706 行）**之后**插入：

```rust
    // 启动 agent 队列 worker（auth 已就绪）：先做启动恢复（遗留 running → blocked），
    // 再起后台轮询循环，自动领取「已入队」任务执行。失败不阻断应用启动。
    {
        crate::agent::worker::recover_interrupted_runs(&pb_client).await;
        crate::agent::worker::start_worker(handle.clone());
    }
```

> 说明：`pb_client` 在同函数早前（约 680 行）已构造（`PbClient::new(&auth.base_url, &auth.token)`）且实现了 `Clone`；`handle` 是 `setup_pocketbase` 的 `tauri::AppHandle` 参数。若 `pb_client` 在此处已被移动，改用 `PbClient::new(&base, &super_pw?)`——实际用 auth 值重建：`let rec_client = crate::pb::client::PbClient::new(&user_id_base…)`。**实现时先确认 `pb_client` 是否仍可用**（`grep -n "pb_client" src-tauri/src/lib.rs`）；仍可用则直接 `&pb_client`，否则用 `handle.state::<AppState>()` 读 auth 重建一个临时 client 传入。

- [ ] **Step 3: 编译验证**

Run: `cd src-tauri && cargo check`
Expected: 编译通过，无 warning 级以上问题（`Emitter`/`Manager` trait 已 use）。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/agent/worker.rs src-tauri/src/lib.rs
git commit -m "feat(agent): 队列 worker 轮询循环 + 启动恢复 + wiring(S1)"
```

---

## Task 4: 超时显式 kill 子进程（补 agent P1 缺口）

给 CLI 子进程 spawn 设 `kill_on_drop(true)`，使 `execute_task_with_agent` 的 30min 超时 drop future 后子进程真正被终止，不留后台孤儿。此改动对所有 `run_cli` / `run_cli_stream` 调用方均安全（drop 即回收，无孤儿）。

**Files:**
- Modify: `src-tauri/src/commands/cli.rs:221-234`（`build_process`）

**Interfaces:**
- Consumes: `tokio::process::Command`（`build_process` 返回值）。
- Produces: 无新增签名；`build_process` 返回的 Command 带 `kill_on_drop(true)`。

- [ ] **Step 1: 给 `build_process` 加 `kill_on_drop(true)`**

在 `src-tauri/src/commands/cli.rs` 的 `build_process` 里，`stderr(Stdio::piped())` 之后、`if let Some(d) = cwd` 之前，追加一行：

```rust
    // kill_on_drop：future 被 drop（如 execute_task_with_agent 的 30min 超时）时
    // 真正终止子进程，避免 agent 超时后 CLI 仍在后台跑（补 agent P1 缺口）。
    // 对所有调用方安全：正常路径都 await 到子进程自然结束后才 drop。
    c.kill_on_drop(true);
```

改后 `build_process` 主体形如：

```rust
    let mut c = crate::proc::hidden_tokio_command(cand);
    c.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    c.kill_on_drop(true);
    if let Some(d) = cwd {
        if !d.trim().is_empty() {
            c.current_dir(d);
        }
    }
    c
```

- [ ] **Step 2: 更新 executor.rs 的过时注释**

`src-tauri/src/agent/executor.rs:162-164` 有一段「⚠ P2 deferred：run_cli_stream 内部 build_process 未设 kill_on_drop」注释，现已修复，改为：

```rust
    // build_process 已设 kill_on_drop(true)：超时 timeout drop 掉 run_fut 后，
    // 其栈内持有的子进程 Child 随之 drop 并被 kill，不留后台孤儿。
```

- [ ] **Step 3: 编译验证**

Run: `cd src-tauri && cargo check`
Expected: 编译通过。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/commands/cli.rs src-tauri/src/agent/executor.rs
git commit -m "fix(agent): 子进程 kill_on_drop 超时真正终止(补 P1 缺口)"
```

---

## Task 5: TaskCard「派 agent」→「指派」语义 + 已入队徽标 + 事件刷新

把 TaskCard 的「派 agent ▶」下拉从「即时跑一次」改为「指派负责人（写 `agent_provider` + `agent_enqueued=true`，由 worker 领取）」；加「已入队」徽标态；监听 `agent-run-changed` 事件刷新徽标；provider 支持集复用 `agent-filter.ts`。保留「立即跑一次」为次要动作。

**Files:**
- Modify: `src/features/board/TaskCard.tsx`
- Modify: `src/i18n/locales/zh/board.json` / `src/i18n/locales/en/board.json`（本 Task 补 TaskCard 用到的键；看板过滤键在 Task 6）

**Interfaces:**
- Consumes: `updateTask`（board store，`(id, patch)=>Promise<void>`，失败重抛）、`AGENT_FILTER_PROVIDERS`（`./agent-filter`）、`listen`（`@tauri-apps/api/event`）、`ipc.agentRunTask`（保留为「立即跑一次」）。
- Produces: 无对外签名变化（组件内部行为变更）。

- [ ] **Step 1: 复用支持集，删除本地重复常量**

在 `TaskCard.tsx` 顶部：
- 删除本地 `const AGENT_P1_PROVIDERS = new Set(["claude", "codex"]);`（第 51-52 行）。
- 从 `./agent-filter` 引入并改用：

```ts
import { AGENT_FILTER_PROVIDERS } from "./agent-filter";
```

把 `agentProviders` 的 `useMemo` 里 `AGENT_P1_PROVIDERS.has(p.id)` 改为 `AGENT_FILTER_PROVIDERS.has(p.id)`。

- [ ] **Step 2: 「已入队」徽标态**

在 `RUN_STATUS_BADGE` 之后加一个入队徽标常量：

```ts
// 「已入队」徽标（任务已指派 agent 但 worker 尚未开跑时显示）。
const ENQUEUED_BADGE = { label: "已入队", cls: "bg-slate-500/15 text-slate-700 dark:text-slate-400" };
```

在 `runBadge` 计算处（约 188 行）下方加派生量：

```ts
  // 已入队但还没有非终态 run 时，显示「已入队」徽标（worker 领取后会转为「执行中」）。
  const showEnqueued =
    !!task.agent_enqueued &&
    !(latestRun && ["running", "review", "blocked"].includes(latestRun.status));
```

在页脚 `runBadge && latestRun` 那个按钮**之前**插入一个只读徽标：

```tsx
        {/* 已入队徽标（指派后、worker 领取前的过渡态；不可点） */}
        {showEnqueued && (
          <span
            className={cn(
              "flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
              ENQUEUED_BADGE.cls,
            )}
            title={t("agent.enqueuedTitle")}
          >
            {t("agent.enqueued")}
          </span>
        )}
```

- [ ] **Step 3: 下拉语义改为「指派」，保留「立即跑一次」**

新增指派处理函数（放在 `runWithAgent` 之后）：

```ts
  /** 指派 agent 负责人：写 agent_provider + agent_enqueued=true，交由后台 worker 领取执行。 */
  const assignAgent = async (providerId: string) => {
    try {
      await updateTask(task.id, { agent_provider: providerId, agent_enqueued: true });
      toast.success(t("agent.assigned", { name: providerLabel(providerId) }));
    } catch (e) {
      // updateTask 失败已回滚，这里 toast 让用户知情（不吞错）
      toast.error(t("agent.assignError", { msg: String(e) }));
    }
  };
```

把下拉的触发按钮文案与菜单改为「指派」语义。将 `agentProviders.length > 0` 那段（约 427-458 行）替换为：

```tsx
        {/* 「指派 agent」下拉（有可用 provider 时显示；多选模式隐藏防误触）。
            指派 = 写负责人并入队，由后台 worker 自动领取执行（Multica 式指派即派发）。*/}
        {!selectMode && agentProviders.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                disabled={agentRunning}
                title={t("agent.assignTitle")}
                className={cn(
                  "ml-auto flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
                  agentRunning
                    ? "cursor-not-allowed opacity-50 bg-muted text-muted-foreground"
                    : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary",
                )}
              >
                {agentRunning ? t("agent.running") : t("agent.assignBtn")}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuLabel>{t("agent.assignMenuLabel")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {agentProviders.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => void assignAgent(p.id)}>
                  {t("agent.assignTo", { name: providerLabel(p.id) })}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              {/* 次要动作：绕过队列立即跑一次（调试/急用）。*/}
              {agentProviders.map((p) => (
                <DropdownMenuItem
                  key={`run-${p.id}`}
                  onSelect={() => void runWithAgent(p.id)}
                >
                  {t("agent.runNowWith", { name: providerLabel(p.id) })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
```

- [ ] **Step 4: 监听 `agent-run-changed` 刷新徽标**

在 TaskCard 顶部引入：

```ts
import { listen } from "@tauri-apps/api/event";
```

在「挂载时拉最新 run」的 `useEffect`（约 137-152 行）**之后**加一个订阅 effect：

```ts
  // 订阅后台 worker 的 run 变更事件：仅当事件负载是本任务 id 时重新拉最新 run 刷新徽标。
  useEffect(() => {
    let cancelled = false;
    const un = listen<string>("agent-run-changed", (e) => {
      if (cancelled || e.payload !== task.id) return;
      listAgentRuns(task.id)
        .then((runs) => {
          if (!cancelled) setLatestRun(runs[0] ?? null);
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
      void un.then((f) => f());
    };
  }, [task.id]);
```

- [ ] **Step 5: 补 i18n（zh + en）**

在 `src/i18n/locales/zh/board.json` 顶层加 `agent` 段（与 `board`/`project` 同级）：

```json
  "agent": {
    "assignBtn": "指派 agent ▸",
    "running": "执行中…",
    "assignTitle": "指派 agent 负责此任务（自动入队执行）",
    "assignMenuLabel": "指派给",
    "assignTo": "指派给 {{name}}（自动开跑）",
    "runNowWith": "用 {{name}} 立即跑一次",
    "assigned": "已指派 {{name}}，排队执行中",
    "assignError": "指派失败：{{msg}}",
    "enqueued": "已入队",
    "enqueuedTitle": "已指派 agent，等待后台领取执行"
  },
```

在 `src/i18n/locales/en/board.json` 顶层加对应英文：

```json
  "agent": {
    "assignBtn": "Assign agent ▸",
    "running": "Running…",
    "assignTitle": "Assign an agent to own this task (auto-queued)",
    "assignMenuLabel": "Assign to",
    "assignTo": "Assign to {{name}} (auto-run)",
    "runNowWith": "Run once now with {{name}}",
    "assigned": "Assigned {{name}}, queued to run",
    "assignError": "Assign failed: {{msg}}",
    "enqueued": "Queued",
    "enqueuedTitle": "Agent assigned, waiting to be picked up"
  },
```

> 注意：英文 `board.json` 顶层键顺序与 zh 对齐即可；放在 `board` 段之后、`project` 段之前，保持两文件结构一致。

- [ ] **Step 6: tsc 验证**

Run: `pnpm tsc --noEmit`
Expected: 无错。

- [ ] **Step 7: 提交**

```bash
git add src/features/board/TaskCard.tsx src/i18n/locales/zh/board.json src/i18n/locales/en/board.json
git commit -m "feat(board): TaskCard 指派语义(即派发) + 已入队徽标 + 事件刷新(S1)"
```

---

## Task 6: 看板「有 agent 参与」过滤开关

在 KanbanBoard 工具条加一个「有 agent 参与」切换，开启后只显示 `taskHasAgent` 为真的任务。为使过滤仅依赖任务字段（不引额外 run 拉取），S1 的看板级过滤按 `agent_provider`/`agent_enqueued` 判定（`taskHasAgent` 的 `latestRun` 传 `null`）——非终态 run 的任务通常仍带负责人字段，覆盖足够。

**Files:**
- Modify: `src/features/board/KanbanBoard.tsx`
- Modify: `src/i18n/locales/zh/board.json` / `src/i18n/locales/en/board.json`（`board` 段加过滤文案）

**Interfaces:**
- Consumes: `taskHasAgent`（`./agent-filter`）、既有 `showArchived` 工具条模式。
- Produces: 无对外签名变化。

- [ ] **Step 1: 引入 + 状态**

在 KanbanBoard 顶部 import 区加：

```ts
import { taskHasAgent } from "./agent-filter";
```

在 `const [showArchived, setShowArchived] = useState(false);`（第 82 行）下加：

```ts
  // 「有 agent 参与」过滤：开启后只显示已指派/入队/在跑的任务（看板级按任务字段判定）。
  const [agentOnly, setAgentOnly] = useState(false);
```

- [ ] **Step 2: 过滤联动**

把 `visibleByState` 的 `useMemo`（约 109-117 行）里的过滤谓词加入 agent 条件：

```ts
  const visibleByState = useMemo(() => {
    const map: Record<string, BoardTask[]> = {};
    for (const st of sortedStates) {
      map[st.id] = (grouped[st.id] ?? []).filter(
        (t) =>
          (showArchived || !t.archived) &&
          (!agentOnly || taskHasAgent(t, null)) &&
          taskMatchesFilter(t, deferredFilter),
      );
    }
    return map;
  }, [sortedStates, grouped, showArchived, agentOnly, deferredFilter]);
```

- [ ] **Step 3: 工具条按钮**

在「显示归档」按钮（约 573-579 行 `onClick={() => setShowArchived(...)}` 那个 `<button>`）**之后**加一个同款切换按钮：

```tsx
            {/* 「有 agent 参与」过滤：只看已指派/入队/在跑的任务 */}
            <button
              type="button"
              onClick={() => setAgentOnly((v) => !v)}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
                agentOnly
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {agentOnly ? t("board.agentOnlyOn") : t("board.agentOnlyOff")}
            </button>
```

> 若「显示归档」按钮外层有特定容器/间距 class，照抄该按钮的 wrapper 结构保持视觉一致（实现时对齐相邻按钮的 className）。

- [ ] **Step 4: 补 i18n（zh + en，`board` 段内）**

`src/i18n/locales/zh/board.json` 的 `board` 段内（`hideArchived` 之后）加：

```json
    "agentOnlyOff": "有 agent 参与",
    "agentOnlyOn": "✓ 有 agent 参与",
```

`src/i18n/locales/en/board.json` 的 `board` 段内对应加：

```json
    "agentOnlyOff": "Has agent",
    "agentOnlyOn": "✓ Has agent",
```

- [ ] **Step 5: tsc 验证**

Run: `pnpm tsc --noEmit`
Expected: 无错。

- [ ] **Step 6: 提交**

```bash
git add src/features/board/KanbanBoard.tsx src/i18n/locales/zh/board.json src/i18n/locales/en/board.json
git commit -m "feat(board): 看板「有 agent 参与」过滤开关(S1)"
```

---

## Self-Review

**1. Spec coverage（对照 S1 spec §设计）：**
- ①指派动作（C：指派即派发）→ Task 5（下拉写 `agent_provider`+`agent_enqueued`，保留立即跑）。✅
- ②队列 worker（新 `worker.rs`，PbClient 轮询，`pick_eligible`，并发 1，清 enqueued，复用 `execute_task_with_agent`，provider 不支持跳过+清 enqueued）→ Task 2（纯函数）+ Task 3（轮询/wiring）。✅
- ③超时显式 kill → Task 4（`build_process` kill_on_drop）。✅
- ④启动恢复（running→blocked）→ Task 3（`recover_interrupted_runs`）。✅
- ⑤看板指示 + 过滤（已入队徽标 + 「有 agent 参与」+ `taskHasAgent` 纯函数）→ Task 1（纯函数）+ Task 5（徽标）+ Task 6（过滤）。✅
- 数据模型不加集合/字段 ✅；复用清单全覆盖 ✅。
- spec「明确不做」（命名 agents/时间线/列表指示/并发设置 UI/Inbox）——本计划均未涉及。✅

**2. Placeholder scan：** 无 TBD/TODO/“类似上文”；每个代码步骤给出完整代码。Task 3 Step 2 对 `pb_client` 可用性留了「实现时确认」的分支说明（附确切 grep 命令与两条回退路径），非占位而是必要的运行时核对。✅

**3. Type consistency：**
- `EnqueuedTask { task_id, provider }` 在 Task 2 定义、Task 3 构造/消费，字段名一致。✅
- `pick_eligible(&[EnqueuedTask], &HashSet<String>, usize) -> Vec<EnqueuedTask>` 签名 Task 2↔3 一致。✅
- `taskHasAgent(task, latestRun|null)` Task 1 定义、Task 6 以 `null` 调用、Task 5 语义参照（徽标用同一 ACTIVE 状态集）。✅
- `agent-run-changed` 事件：Task 3 emit `String`（task_id），Task 5 `listen<string>` 且比对 `e.payload === task.id`。✅
- `BoardTask.agent_provider/agent_enqueued` Task 1 声明，Task 3（Rust 侧读 PB 字段名 snake_case 一致）、Task 5/6 消费。✅
- `AGENT_FILTER_PROVIDERS` Task 1 导出、Task 5 引用（替换原 `AGENT_P1_PROVIDERS`）。✅
- i18n：Task 5 用 `agent.*`（顶层段），Task 6 用 `board.agentOnly*`（board 段）——命名空间同为 `board` ns，键路径不冲突。✅

**4. 约束落实：** 每个 Task 的 `git add` 均列确切文件、无 `-A`；提交信息无 Co-Authored-By；Rust 测试策略（本机 cargo check + CI 断言）在 Task 2/3 步骤中写明；前端 TDD（Task 1 先测）与 tsc 门槛齐备。✅

---

## Execution Handoff

计划已保存 `docs/superpowers/plans/2026-08-17-board-agent-queue-s1.md`。两种执行方式：

**1. Subagent-Driven（推荐）** —— 每 Task 派新 subagent 实现 + Task 间双阶段审查 + 末尾全分支审查，迭代快。

**2. Inline Execution** —— 本会话内批量执行，带检查点。

选哪个？
