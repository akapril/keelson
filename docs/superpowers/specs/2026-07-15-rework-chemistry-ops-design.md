# rework 阶段③④ —— 化学反应 · 会话驱动的 AI 操作设计

> 版本：v1 · 日期：2026-07-15
> 定位：**存档设计（北极星）**。本块在 [MVP 设计](2026-07-15-rework-mvp-design.md) 的"结合的化学反应"之上展开，对应路线图**阶段③（AI Chat + 权限工具）**与**阶段④（会话→沉淀闭环 + 主动引擎）**。
> 决策（2026-07-15，用户拍板）：**先完成 MVP(阶段0+①)再实现本块**；优先能力 **A/B/C/D 全部**；交互 **按需 🗣 + 主动 ⚡ 都要**，且一律"**AI 出草稿 → 用户确认 → 才落库**"。
> 前置依赖：本块**必须**建在 MVP 之上——会话已被扫描/Tantivy 索引/元数据入 PB，AI 才有东西可读。

---

## 1. 核心机制（一句话）

> 给 AI 两组能力——**读**（你的本地 Claude/Codex 会话）+ **写**（工作台 Docs/Board/Calendar）——中间由**权限模型**约束（AI 持你的 PocketBase token 调 PB，access rules 即服务端二次授权，AI 只能干你能干的事）。所有"操作"本质是 AI 编排"**读会话 → 产候选 → 你确认 → 落库（带溯源回链）**"这条链。

沿用 MVP 已定的权限白送机制与 Agent C 的工具调用架构（rig-core / actor 作用域工具 / 破坏性操作不注册 / 领域授权=PB rules）。

---

## 2. 操作全景（A/B/C/D 全量）

标注：🗣 按需（Chat 下指令）· ⚡ 主动（系统扫会话后建议）。所有落库产出都带 `source_session_id` + `anchor` 溯源。

### A. 会话 → 文档（Docs）
| 操作 | 输入(读) | 输出(写) | 触发 |
|---|---|---|---|
| 项目说明/架构文档(ADR) | 某项目全部会话综合 | `docs_upsert` | 🗣 |
| 开发日志/日报周报 | 某项目某时段会话 | `docs_upsert` | ⚡🗣 |
| CHANGELOG/变更说明 | 会话里"改了什么" | `docs_upsert` | 🗣 |
| 疑难排查文档 | "怎么修好 X"的会话 | `docs_upsert` | 🗣 |
| 决策记录(Decision log) | 会话里的技术决策+理由 | `docs_upsert` | ⚡ |

### B. 会话 → 任务（Board）
| 操作 | 输入 | 输出 | 触发 |
|---|---|---|---|
| 未解决问题 → 待办 | 会话里 TODO/FIXME/未竟事项 | `board_create_task` | ⚡ |
| 报错 → bug 卡 | 会话里的错误 | `board_create_task` | ⚡ |
| "接下来做 X" → 任务分解 | 会话里的后续计划 | `board_create_task`(多条) | 🗣 |

### C. 会话 → 日历/排期（Calendar）
| 操作 | 输入 | 输出 | 触发 |
|---|---|---|---|
| 活跃度驱动排期 | 项目会话密度 + 未完成任务量 | `calendar_create_event`(里程碑/deadline 建议) | ⚡ |
| 时间承诺捕获 | 会话里"周五前搞定"等 | `calendar_create_event` + reminder | ⚡🗣 |
| 反向提醒 | 日历 deadline 临近 → 关联未完成会话/任务 | 通知(见 §6) | ⚡ |
| 周期回顾 | 本周会话摘要 | `calendar_create_event`("每周回顾"+摘要) | ⚡ |

### D. 会话 → 问答/复用（RAG/Chat）
| 操作 | 输入 | 输出 | 触发 |
|---|---|---|---|
| "上次怎么解决的 X" | 会话向量/关键词检索 | Chat 回答 + 跳转会话第 N 步 | 🗣 |
| 跨项目经验复用 | 全库会话检索 | Chat 回答 + 引用 | 🗣 |
| 项目上下文注入 | 该项目历史会话摘要 | 开新会话时预置上下文 | ⚡ |

---

## 3. 工具集（沿用并扩展 Agent C 设计）

### 3.1 会话类工具（读，本产品独有）
- `sessions_search(query?, repo_path?, since?, limit)` → 会话摘要卡列表（只读，经 PB `sessions_meta` 授权发现 + Rust 读磁盘正文）。
- `session_get(session_id, include_events?)` → 单会话完整/分段 transcript。
- `session_search_within(session_id, query)` → 会话内片段定位（配合向量检索，向量库在 Rust 侧）。
- `session_extract(session_id, kinds?[bug/todo/conclusion/decision])` → **只产结构化候选**（每条带 `source_session_id`+`anchor`+`confidence`），**不落库**。

### 3.2 工作台类工具（写，全 upsert，无 delete）
- Docs：`docs_search` / `docs_get` / `docs_upsert(base_revision 乐观锁)` / `docs_replace`
- Board：`board_search_projects` / `board_get_project`(返回 capabilities) / `board_search_tasks` / `board_create_task` / `board_update_task` / `board_upsert_state|label`
- Calendar：`calendar_get_schedule` / `calendar_create_event` / `calendar_update_event`

**授权**：每个写工具持用户 token 调 PB → PB access rules 判定。破坏性操作**不注册**（无 `*_delete`）。`capabilities` 契约由用户角色派生给模型做防御性预判（非安全边界）。

### 3.3 关键设计：抽取与落库解耦（SRP）
`session_extract` 只产候选 → 候选以**可勾选卡片**呈现（自定义工具输出 UI）→ 用户确认 → 才调 `docs_upsert`/`board_create_task`/`calendar_create_event` 落库。这保证：
1. AI 生成物**不污染**工作台（人工确认闸门）。
2. 落库物携带 `source_session_id`+`anchor` → Board/Docs/Calendar 条目**可反跳回原始会话片段**（化学键）。

---

## 4. 两种交互模式

### 4.1 🗣 按需（阶段③先做）
用户在 Chat 里下指令 → AI 走 agent loop（多步：search → extract → 呈现候选 → 确认 → 写）。简单、可控、可解释。这是阶段③的核心，建在 MVP 的会话数据 + Agent C 的 Chat/工具框架上。

### 4.2 ⚡ 主动（阶段④加）——"提议引擎"
系统定时/事件驱动地扫会话，主动生成**建议**推给用户（"你今天在 api 项目有 3 个未解决问题，建任务吗？"/自动起草 devlog）。需额外一层：

**提议引擎（Proposal Engine）设计要点：**
- **触发**：会话增量同步(MVP 已有 watcher)后入队 + 定时(如每日晚间/项目回顾周期)。
- **生成**：对"新增/变化的会话"跑 `session_extract` + 规则（未解决问题、时间承诺、活跃度阈值）→ 产 `proposals`。
- **落库**：提议存入新 collection `proposals`（见 §5），**状态=pending，绝不自动写工作台**。用户在"建议"面板里 accept/dismiss；accept 才触发对应写工具落库。
- **防打扰**：去抖 + 去重（同一会话不反复提议）+ 每日提议上限 + 用户可关某类主动建议（settings）。
- **可解释**：每条提议附来源会话 + 理由 + 置信度。

---

## 5. 数据模型增量（PocketBase，均带 owner + access rules）

- **溯源字段**：`docs` / `board_tasks` / `calendar_events` 增 `source_session_id`(text, 可空) + `source_anchor`(text, 可空) → 支持反跳。
- **`proposals`**（阶段④，主动引擎用）：
  | 字段 | 说明 |
  |---|---|
  | `owner` | 多用户预留 |
  | `kind` | doc/task/event 建议类型 |
  | `source_session_id` + `anchor` | 溯源 |
  | `payload`(json) | 候选内容（拟写的 doc/task/event 草稿） |
  | `reason` / `confidence` | 可解释 |
  | `status` | pending/accepted/dismissed |
  | `created` | 定时清理老 pending |
  索引 `(owner, status, created)`；rules 同 MVP owner 套路。
- **向量检索（RAG，阶段③D）**：会话事件 embedding 存 **Rust 侧**（rig 向量库 / sqlite-vec），不进 PB（正文留磁盘原则）。`session_search_within` 走此索引。

---

## 6. 通知与反向提醒（阶段④）
沿用 workavera 的 notifications 思路（定时调度器）：日历 deadline 临近 / 长期未动项目(retalk 已有雏形) / 周期回顾 → 生成通知。桌面端可走 Tauri 原生通知 + 应用内"建议/通知"面板。

---

## 7. 阶段内切分

| 子阶段 | 内容 | 交付价值 |
|---|---|---|
| **③-1** | AI Chat + 会话类工具(read) + RAG(D) | 能在 Chat 里"问历史会话"，带跳转（最小可用的化学反应） |
| **③-2** | 工作台写工具 + `session_extract` + 草稿确认落库(A/B 按需) | 🗣"把今天 api 会话整理成文档/任务"能跑通，带溯源回链 |
| **④-1** | 溯源字段 + 反跳 UI + Calendar 写(C 按需) | 三大工作台全可由会话按需驱动，条目可回跳会话 |
| **④-2** | 提议引擎 + `proposals` + 建议面板 + 通知(主动 A/B/C) | ⚡ 系统主动扫会话推建议，你只确认 |

建议实现顺序：③-1 → ③-2 → ④-1 → ④-2（按需先于主动，读先于写，写先于主动推）。

---

## 8. 依赖与前置（对 MVP 的要求）
- 会话已被扫描 + Tantivy 索引 + 元数据入 PB `sessions_meta`（MVP Task 8–16 已建）。
- Chat 持久化 collections(`chat_conversations`/`chat_messages`) + `llm_models`（MVP 迁移已设计，阶段③启用）。
- 权限模型（用户 token → PB rules）已在 MVP 生效。
- Agent C 报告里的 Anthropic thinking/tool_use 契约坑、流式(Tauri channel + AI-SDK parts)、run 恢复——阶段③开工前需一个 rig-core reasoning-signature spike（若不足则 Anthropic 路径切 genai）。

---

## 9. 开放问题
1. 主动引擎的默认节奏（每日？每次同步后？）与默认开关（默认开哪些主动建议）。
2. "活跃度驱动排期"的具体启发式（会话密度 + 未完成任务 → deadline 建议）需要产品化打磨，先做规则版、后可学习。
3. RAG embedding 的模型与本地/云选择（隐私：会话正文是否发第三方 embedding 服务——倾向本地 embedding）。
4. 提议的去重/防打扰阈值需实测调参。

---

## 附
本设计基于脑暴阶段 Agent C 的"AI Chat + 权限工具"深度调研 + 本轮用户对操作全景的规划确认。实现前应对照 MVP 完成度与最新 rig-core 生态复核。
