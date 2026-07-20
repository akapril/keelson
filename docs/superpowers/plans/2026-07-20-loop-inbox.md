# 设计提案 + 分阶段计划：Loop 收件箱（Proactive Loop Inbox）

**状态**: Draft（待决策）  **作者**: Alex (PM)  **日期**: 2026-07-20  **等级**: L（含设计决策）
**范围**: 设计提案 + 分阶段计划，**不含代码**。

---

## 0. 一句话定位

把 rework 现有的"单条桌面通知"升级成一个**跨厂商（claude/codex）、桌面级、可批处理的异步事件收件箱**——
当你同时委派 N 个异步 agent loop 时，这里是你唯一需要看的地方：谁完成了、谁卡住了、什么到期了，一屏批量处理掉。

**为什么是护城河**：官方通知（Claude Code / Codex `notify`）只解决"我这一个终端里的这一个 agent 完成了"。
没有人做**跨工具、跨会话、桌面持久化、可批处理**的聚合面。这正是 2026 loop engineering 阶梯（turn→goal→time→proactive）里最痛、最没人管的一环：**人对 N 个 loop 的感知与批处理**。

---

## 1. 现状核查（先核代码，避免重造）

我读了以下实现，结论：**现有通知模型可以扩成收件箱，不需要重造，但需要一次 schema 增量 + UI 分层。**

| 组件 | 文件 | 现状 | 对收件箱的可复用性 |
|------|------|------|------------------|
| 外部动作推送 | `src-tauri/src/mcp/server.rs` `notify_external_action` | 仅 `create_task`/`create_doc` 后推：写 `notifications`（`source:"MCP"`, `kind`, `link`）+ 系统弹窗 | ✅ 已是"事件源→通知记录+桌面弹"的雏形；扩展点清晰 |
| 数据访问层 | `src/lib/pb/notifications.ts` | CRUD + `subscribe("*")` 实时 | ✅ 已有实时订阅；缺按字段查询/批量更新 |
| 状态管理 | `src/store/notifications.ts` | zustand，`upsertById` 幂等、`markAllRead`、`clearAll` | ✅ 批量已读/清空已有；缺过滤/分组/status |
| 类型 | `src/types/notifications.ts` | `AppNotification`: `kind/read/link/source` | ⚠️ `read:boolean` 二态不够；无 `status/group_key/dedupe_key` |
| UI | `src/components/notification-bell.tsx` | 铃铛下拉面板：列表+全部已读+清空+删除+跳转 | ✅ 交互骨架在；面板太小、无过滤/分组/批选 |
| 事件源(前端) | `src/features/notifications/due-reminders.ts` | 启动扫到期任务/事件，`link` 埋 `reminder=` 标记去重 | ✅ **已有"埋 key 去重"模式**——直接升格为 `dedupe_key` 字段 |
| 事件源(前端) | `src/features/notifications/new-sessions.ts` | 启动对比 seen ids，推"发现 N 条新会话"摘要 | ✅ **已有"摘要而非逐条 + 首次只播种 + 可关"**——主动性边界的现成范式 |

**关键发现（省一堆返工）**：
1. `notify_external_action` 已经是后端事件源的唯一收口点——新事件源（agent 完成等）应汇入同一函数或其兄弟，而非各写各的。
2. `due-reminders` 的 `link` 埋标记去重、`new-sessions` 的"首次只播种 + 摘要 + 开关"，**已经是收件箱主动性边界的两个可复用范式**。收件箱不是从零设计防打扰，是把这两招提炼成通用规则层。
3. `read:boolean` 是最大结构债：收件箱需要 `unread → read → actioned/archived` 三态以上，否则"批处理"无从谈起（处理 ≠ 已读）。

---

## 2. 设计提案（每点：推荐 + 备选 + 理由）

### 2.1 事件源

**决策**：分两层——现有源直接归口，新源按"感知成本"排序，只做能可靠拿到信号的。

| 事件源 | 感知方式 | 推荐 | 理由 |
|--------|---------|------|------|
| MCP 外部动作（建任务/文档） | 已有 `notify_external_action` | ✅ 保留，扩到 `update_task`/状态变更 | 零新增基建 |
| 截止/逾期 | 已有 `due-reminders` 前端扫描 | ✅ 保留 | 已幂等 |
| 新会话 | 已有 `new-sessions` | ✅ 保留（作"loop 开始"信号） | 已低噪 |
| **长跑 agent 完成** | 见下方专项决策 | ✅ **经 MCP 上报（推荐）** | 唯一跨厂商、不依赖各家 hook 差异的收口 |
| **Codex 侧事件面** | Codex `notify` + `hooks.json` → 转发脚本 → rework MCP | ✅ 补，但薄 | Codex 的 `agent-turn-complete` 是稳定信号；rework 提供"接收端" |
| goal 命中 | rework 内 AI 流判定 | 🔵 Later | 需先有 goal 定义，YAGNI |

#### 专项决策 A：长跑 agent 完成怎么感知？（核心难点）

- **备选 1 — rework 内 AI 流结束时自推**：只覆盖 rework 内发起的流，覆盖面窄。
- **备选 2 — 轮询 CLI 会话文件变更判定"turn 结束"**：脆、跨厂商格式各异、误报高。
- **✅ 推荐 — 统一 MCP 上报端点 `report_event`**：rework MCP 新增一个工具 `report_loop_event(source, kind, title, link, project_id, dedupe_key)`。
  外部 agent 完成时**主动上报**——来源可以是：
  - Claude Code 的 `Stop`/`SubagentStop`/`SessionEnd` hook → 一行 `curl` 转发脚本 → `report_event`；
  - Codex 的 `notify`（`agent-turn-complete`）或 `hooks.json` 的 `Stop` → 同一转发脚本 → `report_event`；
  - rework 内 AI 流结束 → 直接调同一逻辑。

  **理由（KISS + SOLID/依赖倒置）**：rework 只定义一个**厂商无关的事件契约**，把"如何检测完成"外包给各家 hook（它们最懂自己的生命周期）。rework 不去猜、不去轮询、不追各家 hook schema 变化。一个收口点，N 个适配脚本。这也正好补上"Codex 不注册 SessionEnd/TaskCompleted"的缺口——rework 不模拟这些事件，而是提供一个 Codex 能用 `notify` 喂进来的**统一接收面**。

  **代价**：需要用户装一次转发脚本（我们提供一键生成，写进 `.claude/settings.json` 和 `~/.codex/config.toml`）。这是"配置一次、长期有效"，与现有 MCP 端点接入模式一致（`mcp-endpoint.json` 已是这套心智）。

  **敢砍**：不做会话文件轮询、不做各家 transcript 解析。信号缺失时宁可少一条通知，也不做脆的推断。

### 2.2 数据模型

**✅ 推荐：扩展现有 `notifications` 集合，不建新集合。**

- **备选 — 新建 `loop_events` 集合**：语义更干净，但要重写 SDK/store/订阅/铃铛，且现有 4 类通知得迁移或双写。**违反 YAGNI**——现有集合差的只是几个字段。
- **推荐字段增量**（`notifications` 集合）：

| 字段 | 类型 | 用途 |
|------|------|------|
| `kind` | 已有 select | 保留（info/success/warning/error 影响色点） |
| `source` | 已有 text | 升格为受控来源：`mcp`/`due`/`session`/`agent`/`goal` |
| `status` | **新 select** | `unread` / `read` / `actioned` / `archived`——**取代 `read:boolean`** 是批处理前提；`read` 保留做兼容映射 |
| `group_key` | **新 text** | 分组键：`{project_id}:{source}`，收件箱按项目×来源折叠 |
| `dedupe_key` | **新 text** | 去重键：把 `due-reminders` 现在埋在 `link` 里的 `reminder=...` 提炼出来；唯一索引可选 |
| `link` | 已有 text | 保留（跳转） |

- **去重**：`dedupe_key` 存在则更新（bump `updated` + 计数）而非新建。把散在 `link` 里的约定收敛成一等字段。
- **分组**：`group_key` 前端折叠展示（"项目 A · agent 完成 ×3"）。**分组只在 UI 层**，不建父子记录——KISS。
- **迁移**：写一个 `pb_migrations/17xxxxxxxx_notifications_inbox.js` 加 3 字段 + 回填 `status`（`read?"read":"unread"`）。**决策点：是否给 `dedupe_key` 加唯一索引**（唯一索引更强，但历史数据可能撞——倾向不加唯一索引，靠应用层查存在）。

### 2.3 收件箱 UI

**✅ 推荐：铃铛面板保留为"快览+红标"，新增独立收件箱页 `/inbox` 承载批处理。**

- **备选 — 只扩铃铛下拉面板**：面板宽 320px，塞不下过滤+批选+分组，会变难用。
- **备选 — 只做独立页、砍铃铛**：丢失"随处可见未读红标"的即时感知。
- **推荐 — 两者分工**（SRP）：
  - **铃铛**（复用现有 `notification-bell.tsx`）：红标 + 最近 N 条 + "查看全部 →/inbox"。轻量、不动主交互。
  - **`/inbox` 独立页**：左侧过滤（来源/项目/状态）→ 中间分组列表（`group_key` 折叠）→ 行级复选 + 批量条（标记已读 / 标记已处理 / 归档 / 跳转）。
  - 复用 store 的 `markAllRead`/`clearAll`，扩为**按选中集**批处理。

### 2.4 主动性边界（防打扰——别做成骚扰）

**✅ 推荐：三层，全部复用现有范式，默认克制。**

1. **摘要而非逐条**（复用 `new-sessions` 范式）：同一 `group_key` 短时间内多次 → 折叠成一条"×N"，只弹一次系统通知。
2. **静音/节流规则**（复用 `new-sessions` 的 `PREF_KEY` 开关 + `localStorage`）：
   - 按 `source` 开关（agent 完成可关系统弹、只留应用内）；
   - 全局"勿扰时段"（可选，Later）；
   - 系统级桌面弹窗**仅**用于 `agent 完成` + `逾期`，其余只进应用内（延续 `new-sessions` "只进应用内"的克制）。
3. **首次只播种**（复用 `due-reminders`/`new-sessions`）：新事件源首次运行只建基线不刷屏。

**红线**：系统桌面弹窗默认走"聚焦时不弹"（`notify_external_action` 已有此意图）。批处理体验的成功标准是"每天主动打开一次 `/inbox` 清空"，而非"被弹窗追着跑"。

---

## 3. 非目标 / YAGNI

- ❌ **不做**会话 transcript 轮询/解析来推断 agent 完成——脆、跨厂商、维护地狱。信号靠 hook 上报。
- ❌ **不做**新 `loop_events` 集合——扩现有集合即可。
- ❌ **不做** goal 命中、per-tool（PreToolUse/PostToolUse）级事件——噪声高、无验证需求，Later 再看。
- ❌ **不做**移动端/多端同步收件箱——桌面单机优先。
- ❌ **不做**规则引擎/DSL 过滤——`source`+`localStorage` 开关够用，别造轮子。
- ❌ **不做** `dedupe_key` 唯一索引（倾向）——历史数据风险 > 收益。

---

## 4. 差异化与风险（会不会被官方碾压？）

**风险**：Claude Code / Codex 各自的 `notify`/hook 已能弹桌面通知。用户为何还要 rework 收件箱？

**差异化（三点，官方都给不了）**：
1. **跨厂商聚合**：claude + codex + rework 内流，一个面。官方各管各的终端。
2. **桌面级持久 + 批处理**：官方通知是"弹完即逝"；rework 是**可回看、可过滤、可批量已读/处理/归档**的收件箱。这是"通知" vs "收件箱"的本质差别。
3. **补 Codex 事件面**：Codex 缺 SessionEnd/TaskCompleted 级事件，rework 提供统一接收契约，把 Codex 的 `agent-turn-complete` 也纳入同一批处理流。

**如果官方后续做了跨工具聚合**：rework 仍赢在"与看板/文档/会话中枢同处一个 app、点通知直接跳到对应任务卡"——**上下文闭环**是本地 hub 的天然壁垒。

**北极星贡献**：收件箱把"N 个异步 loop 的完成信号"变成"每日一次批处理清空"，直接拉高**用户主动回访频次与会话中枢日活**——rework 从"偶尔查会话"变成"每天必开的 loop 指挥台"。

---

## 5. 分阶段计划

### 🟢 Phase 1 — MVP：把现有通知聚成可批处理收件箱（无新事件源）
> 目标：证明"收件箱 + 批处理"比"铃铛下拉"更有用。**不碰 agent 完成感知。**

| 任务 | 粒度 | 依赖 |
|------|------|------|
| PB 迁移：`notifications` 加 `status`/`group_key`/`dedupe_key`，回填 `status` | M | — |
| SDK/store：`status` 三态、按 `status`/`source`/`group_key` 查询、按选中集批量更新 | M | 迁移 |
| `due-reminders` 去重从 `link` 标记迁到 `dedupe_key` | S | 迁移 |
| `/inbox` 独立页：过滤 + 分组折叠 + 批选 + 批量（已读/已处理/归档/跳转） | L | store |
| 铃铛瘦身：红标 + 最近 N 条 + "查看全部 →/inbox" | S | store |
| 主动性规则层：`source` 开关 + 摘要折叠（提炼 `new-sessions` 范式） | M | store |

**成功指标**：收件箱可对现有 4 类通知做批处理；`/inbox` 首月周活 ≥ 铃铛点击的 1.5×。

### 🟡 Phase 2 — 增强：接入长跑 agent 完成 + Codex 事件面
> 目标：让收件箱真正承载"N 个异步 loop"。

| 任务 | 粒度 | 依赖 |
|------|------|------|
| MCP 新工具 `report_loop_event(source,kind,title,link,project_id,dedupe_key)` → 归口 `notify_external_action` | M | Phase 1 |
| rework 内 AI 流结束 → 调 `report_loop_event`（`source:"agent"`） | S | 上一项 |
| 一键生成转发脚本 + 写入指引（Claude `Stop/SubagentStop`；Codex `notify`/`hooks.json`） | M | report 工具 |
| 系统桌面弹窗策略：仅 `agent`/逾期弹，其余静默；聚焦不弹 | S | 规则层 |
| `agent` 来源在 `/inbox` 的专属分组与"卡住"标记（长时间无后续事件） | M | report 工具 |

**成功指标**：跨 claude+codex 的完成事件汇入同一收件箱；用户平均并行 loop 数可被单页感知。

### 🔵 Later（信号触发再上）
- goal 命中事件（需先有 goal 定义）
- 勿扰时段 / 更细规则
- per-tool 事件（仅当有明确调试需求）

---

## 6. 决策点（需拍板）

1. **agent 完成感知路线**：确认走 **MCP `report_loop_event` + 各家 hook 转发脚本**（推荐），而非轮询/transcript 解析？
2. **数据模型**：确认**扩现有 `notifications` 集合**（推荐）而非新建 `loop_events`？
3. **`status` 三/四态取值**：`unread/read/actioned/archived` 是否够？`read:boolean` 保留做兼容映射还是直接弃用？
4. **`dedupe_key` 是否加唯一索引**？（倾向不加，应用层查存在。）
5. **UI 形态**：确认**铃铛快览 + `/inbox` 独立页**双层（推荐），而非只扩铃铛面板？
6. **系统桌面弹窗白名单**：确认仅 `agent 完成` + `逾期` 弹系统通知，其余只进应用内？
7. **Phase 1 是否允许零新事件源**先上（证明批处理价值），再进 Phase 2？（推荐是。）

---

## 附：外部信号依据
- Claude Code hooks（Stop/SubagentStop/SessionEnd 公共信封 + stdin JSON）：https://code.claude.com/docs/en/hooks
- Codex `notify`（agent-turn-complete）+ hooks.json：https://developers.openai.com/codex/hooks
