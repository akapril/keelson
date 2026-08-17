# Agent Inbox 汇聚决策（S3）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agent run 落 review/blocked 时写通知（铃铛提醒）+ 在 `/inbox` 新增「Agent 待办」标签集中列出，行内合并/打回/重派 + 展开看日志/diff。

**Architecture:** `execute_task_with_agent` 在每个 review/blocked 终态点调 `notify_decision`（写一条 source=Agent、link=`/inbox?tab=agent` 的 notification）。`ResolvedAgent` 补 `display_name`（队友名，供文案）。前端：`/inbox` 拆「通知/Agent 待办」双标签；待办标签跨项目查 `agent_runs(review/blocked)`，行内快操作复用抽出的 `useAgentRunActions`（AgentRunPanel 与待办行单一真源）。

**Tech Stack:** Rust/Tauri v2、PocketBase（`PbClient`/notifications 集合）、React 19 + TS、zustand、react-i18next、vitest。

设计依据：`docs/superpowers/specs/2026-08-17-agent-inbox-s3-design.md`（已过审）。

## Global Constraints

- **复用 S1/S2 内核不重写**：executor/agent_runs/AgentRunPanel/ipc(agentMergeRun/agentDiscardRun/agentRunTask)/notifications/inbox 全复用。
- **通知覆盖所有终态点**：executor 里落 blocked 有 5 处早退（provider 不支持/repo 空/目录不存在/非 git/worktree 失败）+ 最终 `Outcome::Blocked`；落 review 1 处（最终 `Outcome::Review`）。`notify_decision` 必须在**每一处** patch 成 review/blocked 后调用，漏一处则该受阻不提醒。`title`/`resolved` 在所有落点均在作用域（executor.rs:99 提取 title，resolved 贯穿全函数）。
- **通知写入失败非致命**：eprintln，不阻断 run 落库（`let _ = ...`）。
- **notification source 值 = "Agent"**（不含 `.`——i18next 路径分隔限制）；`link="/inbox?tab=agent"`；`kind` review→`info`/blocked→`warning`。
- **动作单一真源**：抽 `useAgentRunActions`，AgentRunPanel 改用它，行为不回归（合并/打回/重派语义、toast、busy 保持）。
- **store/ipc 失败 toast + 不吞**（沿用现有 AgentRunPanel 范式：成功 toast + 刷新，失败 toast）。
- **中文注释**；**不硬编码**（source/link/kind/status 用常量）。
- **TDD**：纯函数（`build_agent_notification`、`pendingRunSummary`）先写失败测试。Rust 集成靠 `cargo check` + CI；**Windows 本地 `cargo test` 0xc0000139，只验编译**。
- **tsc 通过**；**提交不加 `Co-Authored-By` 尾注**；**git add 精确文件，严禁 `-A`**（工作区有未跟踪 spec/plan + 私有 `docs/promotion/`）。

---

## File Structure

- `src-tauri/src/agent/notify.rs`（新）：`build_agent_notification` 纯函数(+测) + `notify_decision` 异步 helper。
- `src-tauri/src/agent/mod.rs`（改）：`pub mod notify;`。
- `src-tauri/src/agent/resolve.rs`（改）：`ResolvedAgent` 加 `display_name`；resolve_agent 填充（命中=name，回退=provider）。
- `src-tauri/src/agent/executor.rs`（改）：6 个 review/blocked 落点后调 `notify_decision`。
- `src/lib/pb/agent-runs.ts`（改）：`+listPendingAgentRuns()`。
- `src/features/board/agent-todo.ts`（新）：`pendingRunSummary`(+测)。
- `src/features/board/agent-todo.test.ts`（新）。
- `src/features/board/useAgentRunActions.ts`（新）：抽合并/打回/重派。
- `src/features/board/AgentRunPanel.tsx`（改）：改用 `useAgentRunActions`。
- `src/features/inbox/AgentTodoRow.tsx`（新）、`AgentTodoList.tsx`（新）。
- `src/pages/inbox.tsx`（改）：拆双标签 + `?tab=agent`。
- `src/store/notification-prefs.ts`（改）：`NOTIF_TYPES` +Agent。
- i18n `src/i18n/locales/{zh,en}/inbox.json`、`board.json`（改）。

---

## Task 1: Rust —— build_agent_notification 纯函数 + notify_decision + ResolvedAgent.display_name

**Files:**
- Create: `src-tauri/src/agent/notify.rs`
- Modify: `src-tauri/src/agent/mod.rs`（+`pub mod notify;`）
- Modify: `src-tauri/src/agent/resolve.rs`（`ResolvedAgent` 加 `display_name` + 填充）

**Interfaces:**
- Consumes: `crate::pb::client::PbClient`（`create`，async）。
- Produces:
  - `pub fn build_agent_notification(status: &str, agent_name: &str, task_title: &str, blocker: &str) -> (String, String, &'static str)`（返回 title/body/kind）。
  - `pub async fn notify_decision(client: &PbClient, owner_id: &str, status: &str, agent_name: &str, task_title: &str, blocker: &str)`（写 notification；失败非致命）。
  - `ResolvedAgent.display_name: String`（resolve.rs 新字段）。

- [ ] **Step 1: 写 build_agent_notification 失败测试**

创建 `src-tauri/src/agent/notify.rs`（先放纯函数 + 测试，helper 桩）：

```rust
//! agent 决策通知：文案组装（纯函数，可测）+ 写 notification（异步 helper）。
use crate::pb::client::PbClient;
use serde_json::json;

/// notification source 值（不含 `.`——i18next 路径分隔限制）。
pub const AGENT_NOTIF_SOURCE: &str = "Agent";
/// 点击通知的深链目标（/inbox 的 Agent 待办标签）。
pub const AGENT_NOTIF_LINK: &str = "/inbox?tab=agent";

/// 组装 agent 决策通知文案：返回 (title, body, kind)。
/// - review → kind=info（待审，等人合并）
/// - 其它（blocked/超时）→ kind=warning（受阻，需人处理）
pub fn build_agent_notification(
    status: &str,
    agent_name: &str,
    task_title: &str,
    blocker: &str,
) -> (String, String, &'static str) {
    if status == "review" {
        (
            format!("队友 {agent_name} 完成待审"),
            format!("任务「{task_title}」已完成，等待你审阅合并"),
            "info",
        )
    } else {
        (
            format!("队友 {agent_name} 受阻"),
            format!("任务「{task_title}」受阻：{blocker}"),
            "warning",
        )
    }
}

/// 写一条 agent 决策通知（失败非致命，不阻断 run 落库）。
pub async fn notify_decision(
    client: &PbClient,
    owner_id: &str,
    status: &str,
    agent_name: &str,
    task_title: &str,
    blocker: &str,
) {
    let (title, body, kind) = build_agent_notification(status, agent_name, task_title, blocker);
    let _ = client
        .create("notifications", &json!({
            "owner":  owner_id,
            "title":  title,
            "body":   body,
            "kind":   kind,
            "source": AGENT_NOTIF_SOURCE,
            "link":   AGENT_NOTIF_LINK,
            "read":   false,
        }))
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_is_info_and_mentions_task() {
        let (title, body, kind) = build_agent_notification("review", "小K", "修登录", "");
        assert_eq!(kind, "info");
        assert!(title.contains("小K"));
        assert!(body.contains("修登录"));
    }

    #[test]
    fn blocked_is_warning_and_mentions_blocker() {
        let (_t, body, kind) = build_agent_notification("blocked", "小C", "改样式", "超时已终止");
        assert_eq!(kind, "warning");
        assert!(body.contains("改样式"));
        assert!(body.contains("超时已终止"));
    }
}
```

- [ ] **Step 2: 加模块声明**

`src-tauri/src/agent/mod.rs` 末尾加 `pub mod notify;`。

- [ ] **Step 3: ResolvedAgent 加 display_name**

`src-tauri/src/agent/resolve.rs`：
- `ResolvedAgent` 结构加字段：`pub display_name: String,`（中文注释：队友展示名，命中队友=name，回退=provider）。
- resolve_agent 的 fields 串加 `name`（`"id,provider,instructions,skill_prompts,skill_text,timeout_secs,with_tools,auto_commit"` → `"id,name,provider,..."`）。
- 命中分支：`display_name = rec["name"].as_str().filter(|s| !s.is_empty()).unwrap_or(&resolved_provider).to_string()`（name 空则用 provider 兜底）。构造 `ResolvedAgent { ..., display_name }`。
- 回退分支（miss）：`display_name: agent_ref.to_string()`（= provider 名）。

- [ ] **Step 4: 编译验证**

Run: `cd src-tauri && cargo check`
Expected: 编译通过（notify.rs 的 helper 暂未被调用会有 dead_code 警告，Task 2 消除；build_agent_notification 被测试引用无警告）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/agent/mod.rs src-tauri/src/agent/notify.rs src-tauri/src/agent/resolve.rs
git commit -m "feat(agent): agent 决策通知文案纯函数 + notify_decision + display_name(S3)"
```

---

## Task 2: executor 各 review/blocked 终态点写通知

**Files:**
- Modify: `src-tauri/src/agent/executor.rs`

**Interfaces:**
- Consumes: `crate::agent::notify::notify_decision`、`resolved.display_name`、`title`、`owner_id`。

- [ ] **Step 1: 在 6 个终态点后调 notify_decision**

在 `execute_task_with_agent` 内，紧跟每处 `patch("agent_runs", ..., status=blocked/review)` 之后加通知调用（`title`、`resolved.display_name`、`owner_id` 均在作用域）：

1. **provider 不支持**（约 128-133，`return Ok(run_id)` 之前）：
   ```rust
   crate::agent::notify::notify_decision(client, owner_id, "blocked", &resolved.display_name, &title,
       &format!("不支持的 provider：{}（仅 claude/codex）", resolved.provider)).await;
   ```
2. **repo 空**（约 141-146）：blocker = `"项目未设置 repo_path，无法派 agent"`。
3. **目录不存在**（约 152-157）：blocker = `format!("项目目录不存在：{repo}。请检查该项目的 repo_path。")`。
4. **非 git 仓库**（约 161-168）：blocker = 该处的中文提示串。
5. **worktree 失败**（约 177-182）：blocker = `format!("worktree 建立失败：{e}")`。
6. **最终写回**（约 261 `client.patch(...&patch).await` 之后）：按 `oc` 分派：
   ```rust
   match &oc {
       Outcome::Review { .. } =>
           crate::agent::notify::notify_decision(client, owner_id, "review", &resolved.display_name, &title, "").await,
       Outcome::Blocked { reason } =>
           crate::agent::notify::notify_decision(client, owner_id, "blocked", &resolved.display_name, &title, reason).await,
   }
   ```

> 说明：每处 blocker 文案与该处 patch 的 blocker 保持一致（避免通知与 run 记录说法不符）。为免重复长串，可在各早退点先 `let blk = format!(...)`，patch 与 notify 共用同一 `blk`（实现者可自行 DRY，但不得改变 patch 的既有 blocker 文案）。

- [ ] **Step 2: 编译验证**

Run: `cd src-tauri && cargo check`
Expected: 编译通过，notify.rs 的 dead_code 警告消失。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/agent/executor.rs
git commit -m "feat(agent): executor 各 review/blocked 终态写决策通知(S3)"
```

---

## Task 3: 前端 —— listPendingAgentRuns + pendingRunSummary 纯函数 + NOTIF_TYPES

**Files:**
- Modify: `src/lib/pb/agent-runs.ts`（+listPendingAgentRuns）
- Create: `src/features/board/agent-todo.ts`
- Test: `src/features/board/agent-todo.test.ts`
- Modify: `src/store/notification-prefs.ts`（NOTIF_TYPES +Agent）

**Interfaces:**
- Consumes: `pb`、`NOT_DELETED`/`combineFilters`（`src/lib/pb/collections`）、`AgentRun`（`src/types/agent`）。
- Produces:
  - `listPendingAgentRuns(): Promise<AgentRun[]>`
  - `pendingRunSummary(run: AgentRun): string`（review→diff_stat 或"无改动"；blocked→blocker）
  - `NOTIF_TYPES` 增 `{ source: "Agent", label: "Agent（受阻/待审需决策）" }`

- [ ] **Step 1: 写 pendingRunSummary 失败测试**

创建 `src/features/board/agent-todo.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { pendingRunSummary } from "./agent-todo";
import type { AgentRun } from "@/types/agent";

function mkRun(patch: Partial<AgentRun>): AgentRun {
  return {
    id: "r1", task: "t1", project: "p1", provider: "claude", status: "review",
    branch: "", worktree_path: "", blocker: "", no_change: false, diff_stat: "",
    log_tail: "", started: "", ended: "", ...patch,
  };
}

describe("pendingRunSummary", () => {
  it("review 有改动 → 显 diff_stat", () => {
    expect(pendingRunSummary(mkRun({ status: "review", diff_stat: "3 个文件改动" }))).toBe("3 个文件改动");
  });
  it("review 无改动 → 显「无改动」", () => {
    expect(pendingRunSummary(mkRun({ status: "review", diff_stat: "", no_change: true }))).toBe("无改动");
  });
  it("blocked → 显 blocker", () => {
    expect(pendingRunSummary(mkRun({ status: "blocked", blocker: "超时已终止" }))).toBe("超时已终止");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/features/board/agent-todo.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 agent-todo.ts**

```ts
// Agent 待办行的纯函数（可测）：从 run 提取一行摘要。
import type { AgentRun } from "@/types/agent";

/** 待办行摘要：review→diff 概要(空则"无改动")；blocked/其它→blocker。 */
export function pendingRunSummary(run: AgentRun): string {
  if (run.status === "review") {
    return run.diff_stat?.trim() ? run.diff_stat : "无改动";
  }
  return run.blocker?.trim() ? run.blocker : "";
}
```

- [ ] **Step 4: listPendingAgentRuns**

`src/lib/pb/agent-runs.ts` 加：

```ts
/** 跨项目待决策运行（review/blocked，未软删，最新在前）。owner 范围由访问规则保证。 */
export function listPendingAgentRuns(): Promise<AgentRun[]> {
  return pb.collection(COLL).getFullList<AgentRun>({
    requestKey: null,
    filter: combineFilters(NOT_DELETED, `(status = "review" || status = "blocked")`),
    sort: "-started",
  });
}
```

- [ ] **Step 5: NOTIF_TYPES 加 Agent**

`src/store/notification-prefs.ts` 的 `NOTIF_TYPES` 数组加一项：`{ source: "Agent", label: "Agent（受阻/待审需决策）" }`。

- [ ] **Step 6: 测试 + tsc**

Run: `pnpm vitest run src/features/board/agent-todo.test.ts && pnpm tsc --noEmit`
Expected: PASS + tsc 净。

- [ ] **Step 7: 提交**

```bash
git add src/lib/pb/agent-runs.ts src/features/board/agent-todo.ts src/features/board/agent-todo.test.ts src/store/notification-prefs.ts
git commit -m "feat(agent): listPendingAgentRuns + pendingRunSummary + Agent 通知源(S3)"
```

---

## Task 4: 抽 useAgentRunActions（AgentRunPanel 改用，不回归）

**Files:**
- Create: `src/features/board/useAgentRunActions.ts`
- Modify: `src/features/board/AgentRunPanel.tsx`（改用 hook）

**Interfaces:**
- Consumes: `ipc.agentMergeRun/agentDiscardRun/agentRunTask`、`providerLabel`、`toast`。
- Produces:
  - `useAgentRunActions(onDone?: () => void)` → `{ busy: boolean, merge(run): Promise<void>, discard(run): Promise<void>, redispatch(run): Promise<void> }`。
  - 语义（与 AgentRunPanel 现状一致）：merge→`agentMergeRun(run.id)` + toast + onDone；discard→`agentDiscardRun(run.id)` + toast + onDone；redispatch→先 `agentDiscardRun(run.id)` 再 `agentRunTask(run.task, run.agent || run.provider, cb)`（流式，done 时 toast + onDone），触发即 toast「执行中」。失败 toast。

- [ ] **Step 1: 实现 hook**

创建 `src/features/board/useAgentRunActions.ts`：

```ts
// agent run 决策动作（合并/打回/重派）单一真源：AgentRunPanel 与 Agent 待办行共用，避免逻辑两处漂移。
import { useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";
import { providerLabel } from "@/lib/providers";
import type { AgentRun } from "@/types/agent";

export function useAgentRunActions(onDone?: () => void) {
  const [busy, setBusy] = useState(false);

  const merge = async (run: AgentRun) => {
    if (busy) return;
    setBusy(true);
    try {
      await ipc.agentMergeRun(run.id);
      toast.success("已将 Agent 结果合并进主分支");
      onDone?.();
    } catch (e) {
      toast.error(`合并失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const discard = async (run: AgentRun) => {
    if (busy) return;
    setBusy(true);
    try {
      await ipc.agentDiscardRun(run.id);
      toast.success("已打回此次 Agent 运行");
      onDone?.();
    } catch (e) {
      toast.error(`打回失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const redispatch = async (run: AgentRun) => {
    if (busy) return;
    setBusy(true);
    // 重派 agentRef：沿用 S2 末审的 `||` 兜底（空串 run.agent 回退 provider）
    const agentRef = run.agent || run.provider;
    const displayName = providerLabel(run.provider);
    try {
      // 先打回旧 run 清理 worktree，再重派
      await ipc.agentDiscardRun(run.id);
      void ipc.agentRunTask(run.task, agentRef, (e) => {
        if (e.kind === "done") {
          toast.success(`${displayName} 重派完成`);
          onDone?.();
        }
      });
      toast.message(`已重派，执行中…`);
    } catch (e) {
      toast.error(`重派失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return { busy, merge, discard, redispatch };
}
```

- [ ] **Step 2: AgentRunPanel 改用 hook**

`AgentRunPanel.tsx`：删除内联的 `handleMerge`/`handleDiscard`/`handleRedispatch` + 各自 busy state，替换为 `const { busy, merge, discard, redispatch } = useAgentRunActions(() => { onRefresh?.(); /* 现有关闭/刷新逻辑 */ });`；按钮 onClick 改为 `() => void merge(run)` 等（run 为面板当前 run）。**保持按钮的 disabled={busy} 与按状态显示（review 显合并/打回；blocked 显打回/重派）不变**。

> 注意：面板原 redispatch 里 displayName 用的是队友名/`providerLabel`——hook 内统一用 `providerLabel(run.provider)`；若面板此前显示队友名（S2），可接受轻微回退为 provider 名（文案层面，不影响功能）。若要保留队友名，hook 可加可选 `nameOverride` 参数；MVP 用 providerLabel 即可。

- [ ] **Step 3: tsc 验证行为不回归**

Run: `pnpm tsc --noEmit`
Expected: 无错。人工核对：AgentRunPanel 三动作按钮仍按 review/blocked 状态显示、点击调对应 hook 方法。

- [ ] **Step 4: 提交**

```bash
git add src/features/board/useAgentRunActions.ts src/features/board/AgentRunPanel.tsx
git commit -m "refactor(agent): 抽 useAgentRunActions 供面板/待办共用(S3)"
```

---

## Task 5: AgentTodoRow + AgentTodoList

**Files:**
- Create: `src/features/inbox/AgentTodoRow.tsx`
- Create: `src/features/inbox/AgentTodoList.tsx`

**Interfaces:**
- Consumes: `listPendingAgentRuns`、`pendingRunSummary`、`useAgentRunActions`、`useAgentStore`（队友名映射）、`useBoardStore`（项目/任务名，best-effort）、`providerLabel`、`listen`（`@tauri-apps/api/event`，订阅 `agent-run-changed`）。
- Produces:
  - `AgentTodoList`：拉待办 + 状态过滤 + 空态 + 计数（暴露 `count` 供标签徽标，或内部渲染）。
  - `AgentTodoRow`：单行展示 + 行内动作 + 展开详情。

- [ ] **Step 1: AgentTodoRow**

创建 `src/features/inbox/AgentTodoRow.tsx`：单行——状态徽标（待审/受阻）+ 项目名 + 任务标题 + 队友(emoji+名) + `pendingRunSummary(run)` + 相对时间；行内按钮 合并(仅 `run.status==="review"`)/打回/重派（走 `useAgentRunActions`，`busy` 时禁用）；可展开区显 `run.log_tail`（等宽 `pre` 可滚）+ `run.diff_stat`。队友名：`useAgentStore` 的 `agents.find(a=>a.id===run.agent)`（含归档，emoji+name），回退 `providerLabel(run.provider)`。项目/任务名：`useBoardStore` 的 projects/tasks 按 id 查，缺则显 id 尾 6 位兜底。

```tsx
// 关键骨架（完整实现按上述字段）：
import { useState } from "react";
import { useAgentRunActions } from "@/features/board/useAgentRunActions";
import { pendingRunSummary } from "@/features/board/agent-todo";
import type { AgentRun } from "@/types/agent";

interface Props { run: AgentRun; onDone: () => void; }

export function AgentTodoRow({ run, onDone }: Props) {
  const { busy, merge, discard, redispatch } = useAgentRunActions(onDone);
  const [expanded, setExpanded] = useState(false);
  // ...查队友/项目/任务名；渲染徽标+摘要+按钮（合并仅 review）+ 展开 log_tail/diff_stat
  return (/* JSX */ null as any);
}
```

- [ ] **Step 2: AgentTodoList**

创建 `src/features/inbox/AgentTodoList.tsx`：

```tsx
// 关键行为：
// - 挂载 listPendingAgentRuns()；订阅 listen("agent-run-changed") → 重拉（worker 后台新产实时进）。
// - 状态过滤：全部/待审/受阻（本地 filter）。
// - 空态「没有待决策的 agent 运行」。
// - 渲染 AgentTodoRow 列表，onDone=重拉。
// - 顶部计数（列表长度）。
```
挂载 `useAgentStore().load()` 与 `useBoardStore` 数据（若未加载）以支撑名映射（best-effort，缺失兜底不崩）。

- [ ] **Step 3: tsc 验证**

Run: `pnpm tsc --noEmit`
Expected: 无错。

- [ ] **Step 4: 提交**

```bash
git add src/features/inbox/AgentTodoRow.tsx src/features/inbox/AgentTodoList.tsx
git commit -m "feat(agent): Agent 待办行 + 列表(行内合并/打回/重派+展开)(S3)"
```

---

## Task 6: /inbox 拆双标签 + ?tab=agent 深链 + i18n

**Files:**
- Modify: `src/pages/inbox.tsx`
- Modify: `src/i18n/locales/{zh,en}/inbox.json`
- Modify: `src/i18n/locales/{zh,en}/board.json`（若 AgentTodoRow/List 用 board ns 文案）

**Interfaces:**
- Consumes: `AgentTodoList`、`useSearchParams`（react-router）。

- [ ] **Step 1: inbox 拆双标签**

`src/pages/inbox.tsx`：
- 顶部加标签切换「通知 / Agent 待办」（用现有 shadcn `Tabs` 或简单按钮切换；参照 ProjectWorkspace 的 Tabs 用法）。
- 「通知」标签内容 = 现有通知列表（原样，整块移入该标签）。
- 「Agent 待办」标签内容 = `<AgentTodoList />`。
- `?tab=agent` 深链：`useSearchParams` 读 `tab`，`=== "agent"` 则初始选中待办标签；切换标签同步更新 `?tab`（`agent`/`notif`）。
- 待办标签标题带计数徽标（从 AgentTodoList 暴露的 count，或标签内自算）。

- [ ] **Step 2: i18n**

`inbox.json`（zh/en）加：标签名（`tab.notifications`/`tab.agentTodo`）、待办空态、状态过滤（全部/待审/受阻）、行动作按钮（合并/打回/重派）、展开/收起等文案。zh/en 键一致、JSON 有效。（若行/列组件已直接用中文串或 board ns，统一到 inbox ns。）

- [ ] **Step 3: tsc + json + 现有 inbox 测试**

Run: `pnpm tsc --noEmit && pnpm vitest run src/i18n/__tests__/inbox.i18n.test.tsx`
Expected: 无错，i18n 测试过。`node -e "['zh','en'].forEach(l=>{require('./src/i18n/locales/'+l+'/inbox.json');require('./src/i18n/locales/'+l+'/board.json')});console.log('json ok')"`。

- [ ] **Step 4: 提交**

```bash
git add src/pages/inbox.tsx src/i18n/locales/zh/inbox.json src/i18n/locales/en/inbox.json src/i18n/locales/zh/board.json src/i18n/locales/en/board.json
git commit -m "feat(agent): /inbox 拆通知/Agent待办双标签 + 深链(S3)"
```

---

## Self-Review

**1. Spec coverage：**
- §A 感知层（build_agent_notification + notify_decision + 覆盖所有终态点 + display_name）→ Task 1 + Task 2。✅
- §B Agent 待办标签（双标签 + ?tab=agent + 行内快操作 + 展开 + 过滤 + 计数 + 订阅刷新）→ Task 5 + Task 6。✅
- §C 数据/查询/复用（listPendingAgentRuns + 名映射 + useAgentRunActions + AgentRunPanel 改用）→ Task 3 + Task 4 + Task 5。✅
- §D 纯函数/测试（pendingRunSummary + build_agent_notification）→ Task 3 + Task 1。✅
- NOTIF_TYPES +Agent → Task 3。✅
- §E「明确不做」（不改模型/不批量/不去重/不推送/不重排通知标签）→ 无任务涉及。✅

**2. Placeholder scan：** 无 TBD/TODO。Task 5 的 Row/List 给骨架 + 完整行为/字段清单（UI 装配任务，字段与数据来源列全）；纯函数（build_agent_notification/pendingRunSummary）与 notify/query/hook 给完整代码。Task 4 Step 2 的"实现时对齐现有按钮状态显示"附核对点，非占位。

**3. Type consistency：**
- `build_agent_notification(status,agent_name,task_title,blocker)->(String,String,&'static str)` Task 1 定义、notify_decision/executor 用一致。✅
- `notify_decision(client,owner_id,status,agent_name,task_title,blocker)` Task 1 定义、Task 2 六处调用签名一致（status="review"/"blocked"）。✅
- `ResolvedAgent.display_name` Task 1 加、executor（Task 2）用。✅
- `listPendingAgentRuns()`/`pendingRunSummary(run)` Task 3 定义、Task 5 消费。✅
- `useAgentRunActions(onDone)`→`{busy,merge,discard,redispatch}` Task 4 定义、AgentRunPanel(Task 4)/AgentTodoRow(Task 5) 消费一致；redispatch 用 `run.agent || run.provider`（S2 末审一致）。✅
- `agent-run-changed` 事件（S1）Task 5 订阅。✅
- notification 字段（owner/title/body/kind/source/link/read）对齐迁移 1720000500。✅

**4. 约束落实：** 每 Task `git add` 确切文件无 `-A`；提交无 Co-Authored-By；通知覆盖 6 个终态点（Task 2 逐一列）；通知写入非致命；source="Agent" 无点；Rust 测试策略（cargo check+CI）写明；TDD 纯函数先测（Task 1/3）；useAgentRunActions 单一真源避免漂移（Task 4）。✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-17-agent-inbox-s3.md`. 两种执行方式：

**1. Subagent-Driven（推荐）** —— 每 Task 派新 subagent + Task 间双阶段审查 + 末尾全分支审查。

**2. Inline Execution** —— 本会话内批量执行，带检查点。

选哪个？
