# Agent Inbox 汇聚决策（S3）设计文档

> 状态：设计已与用户确认，待 review。
> 属 agent-中心 IA 蓝图的 **S3**（见 [[rework-agent-centric-ia-direction]]）。接已合 master 的 **S1（agent 队列，f08ea93）+ S2（命名队友，ec6d603）**。
> 目标：把"需人决策的 agent run"（受阻/待审）汇进 `/inbox`，一处采纳/合并/打回/重派，闭环人机协作。

## 目标

agent run 落 review（待审）/blocked（受阻/超时）时：①写一条通知（顶部铃铛被动提醒）；②在 `/inbox` 新增的「Agent 待办」标签里跨项目集中列出，行内快操作（合并/打回/重派）+ 展开看日志/diff。让用户不必逐个看板卡片点徽标，在一处处理所有 agent 决策。

## 决策（已确认）

1. **收件箱形态 = /inbox 加「Agent 待办」标签页**（与现有「通知」标签并列）。
2. **双通道**：worker/executor 判定 review/blocked 时**写通知**（source=Agent，link=`/inbox?tab=agent`）+ 待办标签列 agent_runs。
3. **行内快操作 + 展开详情**：行显状态/项目/任务/队友/摘要 + 行内 合并(仅 review)/打回/重派；展开看 log_tail/diff。
4. **抽 `useAgentRunActions` 共享**给 AgentRunPanel（S2）与待办行，避免动作逻辑两处漂移。
5. **逐条不做批量**；**不做通知去重**（MVP）。
6. **单一写入点**：通知写在 `execute_task_with_agent`，同时覆盖 worker 与 run-now 两路。

## 现状基线

- `/inbox` = **notifications 集合**的前端（`src/pages/inbox.tsx`）：通知流，操作=已读/删除/点击跳转（`link`）；按 `source` 偏好过滤（`notification-prefs`）。**无动作按钮**。
- `notifications`（迁移 `1720000500`）：`owner`(rel,required)/`title`(required,max300)/`body`(max2000)/`kind`(select required: info/success/warning/error)/`read`(bool)/`link`(max500)/`source`(max100)。
- `NOTIF_TYPES`（`src/store/notification-prefs.ts`）：已知 source 列表（"沉淀"/"截止提醒"/"会话"/"更新"/"MCP"，均中文、**不含 `.`**——i18next 路径分隔限制）；未知 source 默认显示。
- `agent_runs`（S1/S2）：status(running/review/blocked/merged/discarded)/task/project/provider/**agent**/branch/base_branch/worktree_path/blocker/no_change/diff_stat/log_tail/started/ended/deleted_at。
- `execute_task_with_agent`（`agent/executor.rs`）：写回 run 状态在 `Outcome::Review { no_change }` / `Outcome::Blocked { reason }` 两分支（`client.patch("agent_runs", ...)`）；`client:&PbClient` + `owner_id` + `resolved`（队友，含 provider/agent_id）在作用域内。
- 前端 agent-runs 访问层（`src/lib/pb/agent-runs.ts`）：仅 `listAgentRuns(taskId)`（按 task）。
- ipc（`src/lib/tauri/ipc.ts`）：`agentMergeRun(runId)`、`agentDiscardRun(runId)`、`agentRunTask(taskId, agentRef, onEvent)`、`listAgentRuns`。
- `AgentRunPanel`（`src/features/board/AgentRunPanel.tsx`）：现成的合并/打回/重派 + 日志/diff（S2 末审已把重派 agentRef 改 `run.agent || run.provider`）。
- `agent-run-changed` Tauri 事件（S1）：worker run 状态变化时 emit。
- agents store（`src/store/agents.ts`）、board store（projects/tasks）：供显示名映射。

## A. 感知层（通知，Rust）

在 `execute_task_with_agent` 写回 run 的 `Outcome::Review`/`Blocked` 分支，追加写一条通知：

- 用纯函数组装文案（可测）：`build_agent_notification(status: &str, agent_name: &str, task_title: &str, blocker: &str) -> (title, body, kind)`：
  - review → `kind="info"`，title 如「队友 {agent_name} 完成待审」，body 含 task_title + diff 概要提示。
  - blocked → `kind="warning"`，title 如「队友 {agent_name} 受阻」，body 含 task_title + blocker。
- `client.create("notifications", json!({ owner, title, body, kind, source:"Agent", link:"/inbox?tab=agent", read:false })).await`；失败非致命（eprintln，不影响 run 落库）。
- **覆盖所有终态点**：executor 里"落 blocked"不止最终 `Outcome::Blocked` 一处，还有 provider 不支持 / repo 无效(3 检查) / worktree 建失败 等 pre-run 早退 patch。为免 pre-run 受阻不提醒，抽一个 executor 内局部 async helper `notify_decision(client, owner, status, agent_name, task_title, blocker)`（内部调 `build_agent_notification` + `client.create`），在**每一处**将 run patch 成 review/blocked 后紧接调用它。task_title 早退点若尚未取到则用空串兜底（title 变量在 task 拉取后才有；provider-check 在建 run 后、task 名已读取，repo 检查亦在 task 名之后——实现时确认各早退点 title 是否在作用域，缺则传 ""）。
- `agent_name`：从 resolved 队友取（有 agent_id 时用其 name——需在 executor 拿到 name；若 resolved 未带 name 则回退 provider 名）。**实现细节**：resolve_agent 目前不返回 name；S3 给 `ResolvedAgent` 补一个 `display_name: String`（命中队友=name，回退=provider），executor 写通知与 run 时用它。task_title 从已读取的 `title` 变量取。
- 前端 `NOTIF_TYPES` 加 `{ source: "Agent", label: "Agent（受阻/待审需决策）" }`。

## B. Agent 待办标签（/inbox 拆双标签）

- `src/pages/inbox.tsx`：顶部加标签切换「通知 / Agent 待办」；`?tab=agent` 深链直落待办；「通知」标签内容 = 现有通知流（原样不动）。
- 待办标签 = 新组件 `src/features/inbox/AgentTodoList.tsx`：
  - 挂载拉 `listPendingAgentRuns()`；订阅 `agent-run-changed`（Tauri event）→ 重拉（worker 后台新产 review/blocked 实时进列表）。
  - 顶部状态过滤：全部 / 待审(review) / 受阻(blocked)。
  - 标签标题带未处理计数徽标（列表长度）。
  - 空态：「没有待决策的 agent 运行」。
  - 每行 = `AgentTodoRow.tsx`。
- `AgentTodoRow.tsx`：
  - 显示：状态徽标（待审/受阻）+ 项目名 + 任务标题 + 队友(emoji+名) + 摘要（review→diff_stat；blocked→blocker 截断）+ 相对时间（复用 inbox 的 whenLabel 风格）。
  - 行内快操作：合并(仅 review)/打回/重派（走 `useAgentRunActions`）。
  - 展开区：`log_tail`（等宽可滚）+ `diff_stat`。

## C. 数据 / 查询 / 复用

- `src/lib/pb/agent-runs.ts` 加 `listPendingAgentRuns(): Promise<AgentRun[]>`：filter `deleted_at="" && (status="review" || status="blocked")`，sort `-started`。owner 范围由访问规则保证。
- 显示名映射（纯前端 join）：
  - 项目名/任务标题：优先 board store 已加载的 `projects`/`tasks`；缺失则按 run.project/run.task 补拉（best-effort，缺则显 id 尾段兜底）。
  - 队友：agents store `agents.find(a => a.id === run.agent)`（含归档，参照 S2 末审 M1）；回退 `providerLabel(run.provider)`。
- 抽共享动作 `src/features/board/useAgentRunActions.ts`：
  - `useAgentRunActions()` 返回 `{ merge(run), discard(run), redispatch(run) }`，各自 try/catch + toast + 可选 onDone 回调。
  - merge→`ipc.agentMergeRun(run.id)`；discard→`ipc.agentDiscardRun(run.id)`；redispatch→`ipc.agentRunTask(run.task, run.agent || run.provider, cb)`。
  - **`AgentRunPanel` 改用此 hook**（把现有内联动作逻辑替换为调用它），待办行也用它——单一真源。
- 动作成功：乐观从待办列表移除该行 + 重拉校正 + toast。

## D. 纯函数 / 测试

- 前端纯函数：`pendingRunSummary(run): string`（review→diff_stat 或"无改动"；blocked→blocker）、`runStatusLabel(status)` 配 vitest。
- Rust 纯函数：`build_agent_notification(status, agent_name, task_title, blocker) -> (String,String,&str)` 配单测（review/blocked 文案 + kind）。
- 集成：GUI 点验 agent 受阻 → 铃铛计数 + 待办标签出现该行 → 行内打回/重派/合并 → 列表刷新。

## 文件影响

- Rust：`agent/executor.rs`（review/blocked 写通知 + 用 display_name）、`agent/resolve.rs`（`ResolvedAgent` 加 `display_name`）、新 `agent/notify.rs`（`build_agent_notification` 纯函数 + 测）。
- 前端：`src/lib/pb/agent-runs.ts`（+listPendingAgentRuns）、`src/pages/inbox.tsx`（拆双标签 + ?tab=agent）、新 `src/features/inbox/AgentTodoList.tsx`、`src/features/inbox/AgentTodoRow.tsx`、新 `src/features/board/useAgentRunActions.ts`（AgentRunPanel 改用）、`src/features/board/agent-todo.ts`（纯函数 pendingRunSummary/runStatusLabel + 测）、`src/store/notification-prefs.ts`（+Agent source）、i18n（inbox/board ns）。

## E. 明确不做（YAGNI / 边界）

- 不改 agent_runs 数据模型（仅加查询 + 通知写入）。
- 不做批量操作（多选合并/打回）——MVP 逐条。
- 不做通知去重/合并（每次 review/blocked 一条）。
- 不做跨设备推送/邮件（本地铃铛；多机同步另轨）。
- 不重排现有「通知」标签本身（只并列加一个标签）。
- 侧栏「Inbox 正名 / 归 Agent 团队组」属 S5，不在此做。

## 协同边界（继承 S2）

人↔AI 本地单用户：通知与待办都本地；合并仍是人工点击（worker 绝不自动合并主干）。

## 约束（继承全局）

- 复用 S1/S2 内核（executor/agent_runs/AgentRunPanel/ipc）+ notifications/inbox，不重写。
- TDD：纯函数先写失败测试；Rust 集成靠 cargo check + CI（Windows 本地 cargo test 0xc0000139）。
- store 写失败重抛 + toast；中文注释；不硬编码（source/link/kind 用常量）。
- notification source 值不含 `.`（i18next 限制）。
- 通知写入失败非致命，不阻断 run 落库。
- 安全：动作仍走人工审查；worker 绝不自动合并。
- 提交不加 `Co-Authored-By: Claude` 尾注。

## 分期

单一实现计划。任务顺序建议：①Rust `build_agent_notification` 纯函数(+测) + `ResolvedAgent.display_name`；②executor review/blocked 写通知（用①）；③前端 `agent-todo.ts` 纯函数(+测) + `listPendingAgentRuns` + `NOTIF_TYPES` 加 Agent；④抽 `useAgentRunActions`（AgentRunPanel 改用，行为不回归）；⑤`AgentTodoRow` + `AgentTodoList`；⑥`/inbox` 拆双标签 + ?tab=agent 深链 + i18n。
