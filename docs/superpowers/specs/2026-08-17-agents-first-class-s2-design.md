# Agents 一等公民（S2）设计文档

> 状态：设计已与用户确认，待 review。
> 属 agent-中心 IA 蓝图的 **S2**（见 [[rework-agent-centric-ia-direction]]）。接已合 master 的 **S1「看板=agent队列」**（`docs/superpowers/plans/2026-08-17-board-agent-queue-s1.md`，f08ea93）。
> 目标：把"派活选 CLI provider"升级为"派活选**命名队友**（小K/小C…）"。队友 = provider CLI + 默认指令 + 绑技能 + 运行时偏好 + 名/头像。Multica 灵魂。

## 目标

引入 `agent_profiles`（命名 AI 队友）作为一等实体：一个队友封装底层 provider CLI、默认指令、绑定技能、运行时偏好、名与头像。看板指派从"选 claude/codex"变为"派给 小K/小C"。worker 执行时把队友的这些属性注入执行内核。队友删除不破坏历史 run。

## 决策（已确认）

1. **队友承载全套**：名/头像 + provider + 默认指令 + 绑技能（关联 prompts **且** 额外自由文本）+ 运行时偏好（超时覆盖 + 并发上限 + 工具/危险标志 + 默认提交行为）。吸收 S4/S6 各一部分，但边界见 §E。
2. **技能 = 关联 prompts 库 + 自由文本** 两者都支持。
3. **运行时偏好四项全做**：`timeout_secs` / `max_concurrent` / `with_tools` / `auto_commit`。
4. **加 `board_tasks.agent_id` FK + 预置默认队友**：迁移建 Claude/Codex 两个默认队友，回填现有 `agent_provider` 非空任务的 `agent_id`；worker 优先 `agent_id`，空则回退 `agent_provider`（兼容 S1 直跑/旧数据）。
5. **头像 MVP 用 emoji**（不做图片上传）。
6. **先只加「Agents」侧栏入口**，不做 S5 的三组重排。
7. **删队友走软删 + 任务回退 provider**（不硬删、不级联清任务）。

## 现状基线（S1 已在 master）

- `board_tasks`：`agent_provider`(text,max40) / `agent_enqueued`(bool)（迁移 `1786300000_agent_runs.js`）。
- `agent_runs` 集合：owner/task/project/**provider**(text)/status(running|review|blocked|merged|discarded)/branch/base_branch/worktree_path/exit_code/blocker/no_change/diff_stat/log_tail/deleted_at/started/ended。
- Rust `agent/executor.rs`：`execute_task_with_agent(client, owner_id, task_id, provider: &str, on_line) -> Result<String>`；内部 `build_task_prompt(title,desc,pname,task_id)` + `run_cli_stream(cli_provider, None, Some(wt), &msgs, with_tools=true, on_line)` + `tokio::time::timeout(AGENT_TIMEOUT_SECS=1800, ...)`；`agent_run_provider_id(provider)->Option<&str>`（claude→claude-cli/codex→codex-cli/else None）。
- Rust `agent/worker.rs`：`pick_eligible(candidates, running_task_ids, concurrency)` 纯函数；`AGENT_CONCURRENCY=1` 全局常量；`poll_once` 拉 `agent_enqueued=true && agent_provider!=""` 候选、排除非终态 run 任务、按并发派发。
- Rust `agent/prompt.rs`：`build_task_prompt` 固定模板（无按 agent 定制）。
- 前端：`TaskCard` 指派下拉写 `agent_provider`+`agent_enqueued`；`AGENT_FILTER_PROVIDERS`/`taskHasAgent`（`agent-filter.ts`）；`AgentRunPanel`；`agent-run-logs`；`lib/pb/agent-runs.ts`。
- `prompts` 集合（`1720001700_prompts.js`）：owner/title/content(max0)/tags/type。
- provider 元数据 `src/lib/providers.ts`：`PROVIDER_META`（label+dot+chip 色），`providerLabel(id)`。
- Provider 执行支持集 = claude/codex（S1 P1 限定）。

## A. 数据模型

### 新集合 `agent_profiles`（迁移 `1786400000_agent_profiles.js`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `owner` | relation(users) required cascadeDelete maxSelect:1 | 归属 |
| `name` | text required max:100 | 队友名（"小K"） |
| `emoji` | text max:16 | 头像 emoji（🤖）；空则用 provider 首字母兜底 |
| `color` | text max:40 | 主题色键（provider 色板值之一或自选）；空则用 provider 默认色 |
| `provider` | text required max:40 | 底层 CLI（claude/codex，受支持集约束） |
| `instructions` | text max:0 | 默认指令（prepend 任务 prompt）；可空 |
| `skill_prompts` | relation(prompts) maxSelect:20 | 绑定的指令库技能（多选） |
| `skill_text` | text max:0 | 额外自由文本技能；可空 |
| `timeout_secs` | number | 超时覆盖（空/0=全局 1800） |
| `max_concurrent` | number | 该 agent 并发上限（空/0=默认 1） |
| `with_tools` | bool | 工具/危险标志（默认 true） |
| `auto_commit` | bool | 完成后在 worktree 自动 commit（不 push）（默认 false） |
| `archived` | bool | 软隐藏（列表默认不显） |
| `deleted_at` | date | 软删（多机同步一致；沿用项目软删范式） |
| `created`/`updated` | autodate | |

访问规则：owner 范围（沿用 board_projects 等集合的 `owner = @request.auth.id` 范式）。

### `board_tasks` 加字段（同迁移或紧邻迁移）

- `agent_id`：text（max:200，存 agent_profiles 记录 id；用 text 而非 relation 以便队友软删后任务侧仍留 id 做回退判断）。空则回退 `agent_provider`。

### `agent_runs` 加字段

- `agent`：text（max:200，派活时的 agent id，溯源用）。run 仍保留已解析的 `provider`（text）不变——即便队友后被删/改，历史 run 的 provider 语义仍完整。

## B. 后端：解析 + 注入 + 按 agent 并发

### B1. 队友解析（executor）

`execute_task_with_agent` 签名从 `provider: &str` 改为 `agent_ref: &str`（语义：优先当 agent_id 解析；解析失败则当原始 provider 回退）：

```
async fn resolve_agent(client, agent_ref) -> ResolvedAgent
```

- 若 `agent_ref` 命中 `agent_profiles.id` → 取 provider/instructions/skill_prompts(content)/skill_text/timeout_secs/max_concurrent/with_tools/auto_commit。
- 否则把 `agent_ref` 当原始 provider（S1 直跑/旧数据兼容），其余偏好取默认（instructions 空、with_tools=true、timeout=全局、auto_commit=false）。
- provider 仍经 `agent_run_provider_id` 校验支持集，不支持照 S1 逻辑落 blocked。

`ResolvedAgent { provider, instructions, skills: Vec<String>, skill_text, timeout_secs: Option<u64>, with_tools: bool, auto_commit: bool, agent_id: Option<String> }`（纯结构，便于测 prompt 组装）。

run 记录写入：`provider`=解析出的 provider，`agent`=agent_id（回退时为空）。

### B2. prompt 注入（prompt.rs）

`build_task_prompt` 增参 `agent_instructions: &str, skills: &[String], skill_text: &str`：在现有任务/要求块**之前**插入队友身份 + instructions；在其后附「# 技能/参考」段，依次列出各 `skills` 内容 + `skill_text`。空段跳过。保持纯函数 + 单测（拼接顺序、空段省略、原任务字段仍在）。

### B3. 运行时注入（executor）

- `run_cli_stream(..., with_tools = resolved.with_tools, ...)`。
- `tokio::time::timeout(resolved.timeout_secs.unwrap_or(AGENT_TIMEOUT_SECS), run_fut)`。
- `auto_commit=true` 且判定为 review（有改动）时：在 worktree `git add -A && git commit -m "agent: task <id>"`（不 push），落一条说明到 run.log_tail/diff_stat。复用 `worktree` 里的 git 封装；失败不致命（仍留工作区）。

### B4. 按 agent 并发（worker）

- 全局 `AGENT_CONCURRENCY` 退居"总闸兜底"（防失控，仍限制同时总 run 数）。
- **候选查询更新**：S1 的 `agent_enqueued = true && agent_provider != ""` 改为 `agent_enqueued = true && (agent_id != "" || agent_provider != "")`（认 agent_id 或回退 provider）；候选的 `agent_ref` 取 `agent_id` 非空则用之，否则用 `agent_provider`。
- `poll_once` 先拉一次活跃 `agent_profiles`（id→max_concurrent 映射），按 **(agent → 在跑数)** 分组：某任务仅当其 agent 在跑数 < 该 agent 的 `max_concurrent`（默认 1）**且**总在跑数 < 全局兜底时才派。回退 provider（无 agent_id）的任务按"伪 agent = provider 名"归组，用默认并发 1。
- `pick_eligible` 扩展为按 agent 分组计槽（纯函数，新增按 agent-limit 的单测）。候选需带 `agent_ref` + 该 agent 的 `max_concurrent`；running 集需带 agent 维度（task→agent 映射由候选/运行记录携带）。

## C. 前端

### C1. Agents 管理页

- 新 `src/pages/agents.tsx` + `/agents` 路由（lazy，DashboardLayout 下）+ `src/lib/navigation.ts` 加「Agents」入口（图标如 `RoboticIcon`/机器人；先加入口，S5 再归组）。
- 列表：队友卡片网格（emoji + 色点 + 名 + provider 徽标 + 技能数 + 运行时偏好摘要）；新建 / 编辑 / 归档 / 删除（软删）。空态引导"建第一个队友"。
- 编辑抽屉/表单：名 · emoji（输入或简单 picker）· 色（provider 色板下拉，默认随 provider）· provider 下拉（claude/codex）· 默认指令 textarea · 绑技能（prompts 库多选）· 自由文本技能 textarea · 运行时偏好（timeout 数字 / max_concurrent 数字 / with_tools 开关 / auto_commit 开关）。
- 数据层：`src/types/agent-profile.ts`、`src/lib/pb/agents.ts`（list/create/update/softDelete）、`src/store/agents.ts`（zustand，乐观更新**写失败重抛+toast**，沿用 board store 范式）。

### C2. 指派改选队友（TaskCard）

- S1 的"指派给 claude/codex"下拉换成列 `agent_profiles`（活跃、未软删）——"指派给 **小K**（🤖 claude）"；选中写 `task.agent_id`（不再写 agent_provider）+ `agent_enqueued=true`。
- 队友库为空 → 菜单提示"先去 Agents 页建队友"（链接 `/agents`）。
- 徽标：显示队友 emoji + 名（取代裸 provider 名）。`assignLocked`（S1 防手滑）沿用。
- 保留"立即跑一次"次要动作（改为按队友跑）。

### C3. 徽标 / 过滤 / 面板

- `taskHasAgent` 增 `agent_id` 判据（有 agent_id 也算"有 agent 参与"）。
- `AgentRunPanel` 顶部显示执行队友（emoji+名，从 run.agent 反查；查不到回退 provider）。

## D. 迁移 / 预置 / 兼容

迁移 `1786400000_agent_profiles.js`（up）：

1. 建 `agent_profiles` 集合（含索引 `idx_agent_profiles_owner`）。
2. `board_tasks` 加 `agent_id`；`agent_runs` 加 `agent`。
3. **预置默认队友**（owner=本地用户，查 users 首条 / local-user）：
   - Claude：name="Claude"、emoji="🤖"、color=amber 键、provider="claude"、with_tools=true。
   - Codex：name="Codex"、emoji="⚡"、color=sky 键、provider="codex"、with_tools=true。
4. **回填**：遍历 `board_tasks` 中 `agent_provider` 非空的记录，把 `agent_id` 设为对应默认队友 id（provider 匹配）。
5. down：删两集合字段 + `agent_profiles` 集合（沿用 S1 迁移 down 范式）。

worker/executor：`agent_id` 优先解析；为空回退 `agent_provider`。S1 直跑入口（`agent_run_task` 命令）与旧数据均不破。

## 协同模型（钉死边界）

S2 的协同是 **人 ↔ AI agent，全本地**：你派活（看板写 `task.agent_id`）→ agent 在你机器的隔离 worktree 里跑 → 产物回 review/受阻由你审 → 你点合并落主干。数据本地、agent 本地跑、你本地审，**不需要同步**。"队友"是 AI agent 的隐喻（对标 Multica agent-as-assignee），不是真人。

**明确不是**：①真人多人协同（多人共享看板、互见彼此 agent）——需托管 PB + 多用户 auth + 实时同步，属独立大轨道（软删地基已合、P2 sync worker 未做），不在 S2；②agent↔agent 接力编排（一个规划一个实现）——属更后的编排能力，不在 S2（S2 = 一任务一 agent + 并发上限）。

## E. 明确不做（YAGNI / 边界）

- 头像**图片上传**（MVP emoji）。
- **S4 归属**：多机/云运行时、"哪台机器跑"路由、进程页升格——S2 只做 per-agent 超时/并发/工具/提交偏好，不碰机器。
- **S6 归属**：prompts 升级为独立"技能"实体、技能市场/版本——S2 只"关联现有 prompts + 自由文本"。
- **S5 归属**：侧栏三组重排、会话中枢降级——S2 只加一个「Agents」入口。
- 派活时**临时覆盖队友参数**（改 profile 即可）。
- 队友**权限/共享/团队**（单用户桌面）。
- 队友级**统计/成本归集**（后续）。

## 约束（继承全局）

- 复用 S1 内核（executor/worktree/worker/AgentRunPanel/agent-runs）与 prompts 库，不重写。
- TDD：纯函数（`build_task_prompt` 注入、`pick_eligible` 按 agent 分组、`taskHasAgent`）先写失败测试；Rust 集成靠 cargo check + CI（Windows 本地 `cargo test` 0xc0000139）。
- store 写失败重抛 + toast；中文注释；不硬编码（全局兜底/默认值用常量）。
- 子进程 spawn 走 `crate::proc::hidden_*`（防 Windows 闪窗）；`kill_on_drop` 沿用。
- 安全：worker 绝不自动合并主干（`auto_commit` 仅在 worktree 内 commit，不 push、不 merge）；指派即跑靠 worktree 隔离 + 审查闸门 + 并发上限兜底。
- 迁移沿用软删/tombstone 范式；`text max:0` 绕 PB 5000 上限用于长文本（instructions/skill_text）。
- 提交不加 `Co-Authored-By: Claude` 尾注。

## 分期

单一实现计划（一个 plan）。任务顺序建议：①迁移+预置+回填 → ②Rust 解析/注入/prompt（含纯函数测）→ ③worker 按 agent 并发（纯函数测）→ ④前端类型/数据层/store → ⑤Agents 页 CRUD → ⑥TaskCard 指派改选队友 + 徽标/面板/过滤 + i18n。
