# 看板 = agent 队列（S1）设计文档

> 状态：设计已与用户确认，待 review。
> 属 agent-中心 IA 蓝图的 **S1**（见 [[rework-agent-centric-ia-direction]]）。接已合 master 的「看板 agent 执行 P1」（[[rework-agent-exec-and-061-stash]]）——即那份 agent spec 里延后的 **P2**。
> 目标：把看板从"任务清单"变成"agent 派发/工作队列"，直接治「看板不怎么用」。

## 目标

给任务**指派一个 agent 负责人 = 自动入队被后台 worker 领取执行**（Multica 式"指派即派发"）；在独立 worktree 跑（复用 agent 执行内核）→ 进「待审」→ 人合并/打回。看板上一眼看出哪些任务在跑/待审/受阻。

## 决策（已确认）

1. **派发模型 = C（指派即派发）**：设 `task.agent_provider`（负责人）→ 自动置 `agent_enqueued=true` → worker 领取跑。
2. **负责人 = provider**（claude/codex）；S2 再升级为命名 agents。
3. **并发默认 1**（命名常量，可后续加设置）。
4. **run → 完整任务时间线放 S3（Inbox）**，S1 不做（S1 复用现有 AgentRunPanel）。
5. **跨视图指示先落看板**（master 上的 KanbanBoard/TaskCard）；列表视图在 parked 的 B 分支，S1 不依赖它。

## 现状基线（agent P1 已在 master）

- 迁移 `1786300000_agent_runs.js`：`board_tasks` 有 `agent_provider`(text)/`agent_enqueued`(bool)；`agent_runs` 集合（status: running/review/blocked/merged/discarded，含 branch/worktree_path/base_branch/log_tail 等）。
- Rust `src-tauri/src/agent/`：`executor.rs`（`execute_task_with_agent(client, owner_id, task_id, provider, on_line)->Result<String>`、`agent_run_provider_id`、`executor_get_run`；`AGENT_TIMEOUT_SECS=1800`；**kill_on_drop 未设**=已知缺口）、`worktree.rs`、`prompt.rs`、`outcome.rs`。
- Rust `commands/agent.rs`：`agent_run_task`(Channel 即时跑)/`agent_merge_run`/`agent_discard_run`/`list_agent_runs`；auth 经 `make_client(state)`。
- 前端：`TaskCard` 有「派 agent ▶ provider」下拉（现=**即时跑** `ipc.agentRunTask`）+ 运行状态徽标；`AgentRunPanel`（日志/diff/合并/打回/重派）；`agent-run-logs` store（实时日志）；`lib/pb/agent-runs.ts`；`types/agent.ts`；ipc 绑定。
- **缺**：队列 worker（agent P1 spec 里的 `agent/worker.rs` 当时延后未做）。

## 设计

### 1. 指派动作（C：指派即派发）

`TaskCard` 的「派 agent」下拉语义从"即时跑一次"改为"**指派负责人**"：
- 选 provider → 前端 `updateTask(taskId, { agent_provider: provider, agent_enqueued: true })`（走现有 board store `updateTask`，写失败重抛+toast）。
- 这会被 worker 自动领取执行——**不再前端直接 `agentRunTask`**（即时跑保留为可选"立即跑一次"入口，或移除；见"保留/裁剪"）。
- 卡片显示负责人徽标（provider 色点 + 名）。
- **防手滑**：下拉项文案明确「指派给 claude（将自动开跑）」；已在跑/待审时该任务的指派入口禁用或提示。

### 2. 队列 worker（Rust，新 `src-tauri/src/agent/worker.rs`）

- 进程内 tokio 循环（应用启动、PB 就绪后启动；间隔如 5s，命名常量 `WORKER_POLL_SECS`）。
- 每轮：用 `PbClient` 查「`agent_enqueued=true` 且 `agent_provider` 非空 且 该任务无 status=running 的 agent_run」的任务（纯函数 `pick_eligible(tasks, running_task_ids, concurrency)` 配单测——但 Rust 单测走 CI，Windows 本地 standalone/CI）。
- 并发信号量（`AGENT_CONCURRENCY=1`）；领取即**清 `agent_enqueued`**（防重复领取）+ 由 `execute_task_with_agent` 建 running run（防重入锁）。
- 领取后 `execute_task_with_agent(...)`；`on_line` 广播实时事件（复用现有活动流/Channel 机制，供前端徽标/面板刷新）。
- provider 不支持（`agent_run_provider_id` 返 None）→ 跳过并清 enqueued + 记一条 blocked（避免死循环领取）。

### 3. 超时显式 kill（补 agent P1 缺口）

- `AGENT_TIMEOUT_SECS`（30min）超时后须真正终止子进程。现 `run_cli_stream` 内部 spawn 的子进程 `build_process` 未设 `kill_on_drop`。修：给 agent 执行路径的子进程 spawn **设 `kill_on_drop(true)`**（`cli.rs` 的 `build_process`/`hidden_tokio_command` 处，或 executor 侧持 child handle 显式 kill）。选最小侵入、不影响其它 run_cli_stream 调用方语义的做法（kill_on_drop=true 对所有调用方均安全，无孤儿）。

### 4. 启动恢复

- 应用启动（worker 起之前）把遗留的 `status=running` 的 agent_runs 标 `blocked`（原因："应用重启中断"），worktree 保留待人处理。避免"卡在 running"的僵尸。

### 5. 看板指示 + 过滤

- **徽标**：TaskCard 运行徽标（agent P1 已有：执行中/待审/受阻）扩一态「已入队」（agent_enqueued 且未跑）。
- **过滤**：看板工具条加「有 agent 参与」开关（过滤出有 agent_provider/enqueued/run 的任务）——纯函数 `taskHasAgent(task, latestRun)` 配 vitest。
- 列表视图指示 = 待 B/后续 IA（S1 不做）。

## 复用（不重写业务）

`execute_task_with_agent`/`worktree`/`AgentRunPanel`/`agent-run-logs`/`agent-runs` 访问层/`board store.updateTask` 全复用；S1 主要**加 worker + 改指派语义 + kill 修复 + 启动恢复 + 过滤**。

## 数据模型

字段已够（`agent_provider`/`agent_enqueued` + `agent_runs`）。S1 **不加集合/字段**（并发用常量，非 DB）。

## 文件影响

- 新增 `src-tauri/src/agent/worker.rs`（worker 循环 + `pick_eligible` 纯函数 + 常量）
- 修改 `src-tauri/src/lib.rs`（启动 worker + 启动恢复遗留 running run）
- 修改 `src-tauri/src/commands/cli.rs` 或 `agent/executor.rs`（子进程 `kill_on_drop(true)` / 显式 kill）
- 修改 `src/features/board/TaskCard.tsx`（「派 agent」→「指派」语义：写 agent_provider+agent_enqueued；负责人徽标；已入队态）
- 修改 `src/features/board/KanbanBoard.tsx` + `task-filter.ts`（「有 agent 参与」过滤 + `taskHasAgent` 纯函数）+ vitest
- i18n `board` ns 补指派/入队/过滤文案

## 约束（继承全局）

- TDD：纯函数（`pick_eligible`/`taskHasAgent`）先写失败测试；Rust 集成靠 cargo check + CI（Windows 本地 cargo test 0xc0000139）。
- 复用 agent P1 内核不重写；中文注释；不硬编码（并发/轮询间隔用常量）。
- store 写失败重抛+toast。
- 子进程 spawn 走 `crate::proc::hidden_*`（防 Windows 闪窗）。
- **安全**：指派即跑靠 worktree 隔离 + 审查闸门兜底、并发默认 1、超时 kill；绝不自动合并主干。
- 提交不加 `Co-Authored-By: Claude` 尾注。

## 明确不做（YAGNI / S1 外）

- 命名 agents（S2）——S1 用 provider 直接当负责人。
- run→完整任务时间线 / 评论（S3 Inbox）。
- 列表/时间线/泳道视图的 agent 指示（依赖 parked B / 后续 IA）。
- 并发数的设置页 UI（先常量 1；config 可后加）。
- Inbox 汇聚（S3）。

## 保留/裁剪待定（实现时定，非阻塞）

- 现有「即时跑一次」入口（`agentRunTask`）：S1 后是否保留为"绕过队列立即跑"的次要动作，还是全部走队列。倾向**保留为次要**（调试/急用），主动作是指派。
