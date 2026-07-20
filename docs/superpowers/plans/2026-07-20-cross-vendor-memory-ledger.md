# 跨厂商记忆账本（Cross-Vendor Memory Ledger）—— 设计提案 + 分阶段计划

> 版本：v1（提案）· 日期：2026-07-20 · 作者：Alex（PM）
> 类型：**L 级 · 需设计决策**。本文只出**设计 + 分阶段计划 + 待拍板决策**，**不写代码**。
> 定位：护城河级功能。建在 rework 已有的**跨厂商会话聚合层**之上，把散落在 Claude / Codex 会话里的记忆抽成**一份去重、可溯源的本地知识层**，并能**回填注入**回任一 CLI。

---

## 0. 先核代码：可复用什么，别重造什么

本提案已核对现有实现，结论是 **90% 的地基已存在**，记忆账本主要是"组合 + 一张新表 + 一层去重"，而非从零造轮子。

| 现有能力 | 文件 | 记忆账本如何复用 |
|---|---|---|
| 跨厂商会话聚合（扫描 + Tantivy + `AppState.sessions` + `sessions_meta`） | `src-tauri/src/mcp/session_tools.rs`、`search/session_backend` | 记忆的**唯一原料来源**。抽取直接读 `state.sessions` + `reg.read_timeline` |
| 会话→候选抽取（AI 出 JSON → 纯函数解析） | `src/features/chemistry/extract.ts`（`EXTRACT_SYSTEM` / `buildContext` / `parseCandidates`） | **直接照搬套路**：换 prompt + 换 schema（记忆条目而非 task/doc），解析器结构复用 |
| "AI 出草稿 → 人工勾选确认 → 才落库"闸门 UI | `src/features/chemistry/DistillDialog.tsx` | **直接照搬**成 `MemoryReviewDialog`：候选记忆列表 + 复选 + 写入 |
| MCP 工具注册/分发/schema 模式 | `src-tauri/src/mcp/{registry,tools,session_tools,server}.rs` | 新增 `search_memory` 读工具**照 `session_tools.rs` 的 `is_session_tool` + `dispatch_session` 模式**加一组，零架构改动 |
| PB 集合迁移范式（owner + access rules + 索引 + seed） | `pb_migrations/1720000100_board.js` | 新 `memories` 集合照抄字段工厂 + owner-only 规则 |
| 溯源回链字段范式 | `board_tasks.source_session_id / source_provider / source_anchor` | 记忆条目**必须**带同款溯源字段 |
| AI 调用（非流式 `ai_chat`，provider 无关） | `src-tauri/src/commands/ai.rs` | 抽取阶段调 `ipc.aiChat`，与 DistillDialog 完全一致 |
| 化学反应设计（已存档，含 `session_extract` 解耦、`proposals` 主动引擎、RAG Rust 侧向量库） | `specs/2026-07-15-rework-chemistry-ops-design.md` | 记忆账本是化学反应的**姊妹分支**（沉淀去 Board/Docs → 沉淀去 Memory）。**必须与之划清边界，见 §5** |

**关键现实约束（已核实）：**
- **RAG / 语义检索默认是 mock**，真语义向量库尚未落地（化学反应 spec §5 明确"向量库在 Rust 侧、rig-core 选型待 spike"）。→ **MVP 的记忆检索必须能只靠关键词（Tantivy）跑通，语义是增强项，不是前置依赖。**
- 会话正文**留磁盘、不进 PB**（隐私原则）。→ 记忆条目正文可以进 PB（它是**提炼过的**结论，不是原始 transcript），但抽取的原料读取仍在 Rust/本机完成。
- MCP server 以 **local-user 身份持用户 PB token** 打 PB，access rules 即授权。→ `search_memory` 工具天然复用这套授权，零新增安全面。

---

## 1. 设计提案（每点：推荐 + 备选 + 理由）

### 1.1 「记忆」是什么 —— 粒度与 Schema

**问题**：一条"记忆"到底存什么？粒度太粗（整段会话）= 没提炼价值，退化成 session_get；太细（每句话）= 噪音淹没信号。

**推荐：4 类 `kind`，一条记忆 = 一个自包含的、可跨会话复用的断言。**

| kind | 定义 | 例子 |
|---|---|---|
| `fact`（事实） | 关于项目/环境/代码库的客观事实 | "本项目 PB 的 text 字段运行时被强制 5000 字符上限" |
| `preference`（偏好） | 用户的稳定偏好/风格约定 | "注释和日志一律用中文" |
| `decision`（决策） | 做过的技术决策 + 理由 | "选 Tantivy+jieba 而非 pgroonga，因本地零依赖" |
| `convention`（项目约定） | 团队/项目的约定规则 | "破坏性操作不注册 MCP 工具" |

**PB 新集合 `memories` schema（照 board.js 字段工厂）：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `owner` | relation→users (required, cascade) | 多用户就绪 |
| `content` | text (required, ≤2000) | 记忆正文（提炼后的一句/一段，非原始 transcript） |
| `kind` | select | fact / preference / decision / convention |
| `scope` | select | `global`（跨项目通用）/ `project`（限某 repo） |
| `repo_path` | text (可空, ≤500) | scope=project 时的缝合键（= `session.project_path`，与 board 同款） |
| `source_session_id` | text (可空, ≤200) | 溯源回跳（照 board_tasks） |
| `source_provider` | text (可空, ≤40) | claude / codex |
| `source_anchor` | text (可空, ≤200) | 会话内定位 |
| `confidence` | number | 抽取置信度 0–1（AI 给 + 人工可改） |
| `status` | select | `active` / `archived`（软删，不做 delete，与"无 delete 工具"一致） |
| `superseded_by` | text (可空) | 去重合并时指向胜出记忆的 id（保留溯源链） |
| `created` / `updated` | autodate | |

索引：`(owner, scope, repo_path)`、`(owner, kind)`、`(owner, status, updated)`。规则：owner-only（照 board_projects）。

**备选 A（更简）**：只存 `content` + `kind` 两字段，不分 scope。
→ 否决：跨项目 vs 项目内是回填注入时的**核心区分**（全局记忆进每个 CLAUDE.md，项目记忆只进对应 repo），砍了它回填就没法做。
**备选 B（更全）**：加 `embedding`(json) 字段直接存向量。
→ 否决：违反"正文/向量留 Rust 侧"原则，且 PB 存高维向量检索效率差。向量走 Rust 侧向量库（与化学反应 RAG 同一套），PB 只存文本。

---

### 1.2 抽取 —— 从会话产候选 + 跨厂商去重

**推荐：复用 chemistry 的"AI 出候选 → 人工确认"套路，新增一个纯函数 `parseMemories` + `MEMORY_EXTRACT_SYSTEM` prompt，落库前做去重合并。**

抽取管线（与 DistillDialog 同构）：
1. 选一个会话（或一个 repo 的一批会话）→ `ipc.sessionTimeline` 取 transcript → `buildContext` 截断（已有）。
2. `ipc.aiChat` + 新 system prompt，要求输出严格 JSON：`{"memories":[{"content","kind","scope","confidence"}]}`。
3. `parseMemories(reply)` 解析（照 `parseCandidates` 的容错：去围栏、截 `{...}`）。
4. **去重**（下节）→ `MemoryReviewDialog` 勾选 → 写 `memories`（带 `source_session_id/provider/anchor`）。

**跨厂商去重（护城河的技术核心）—— 推荐：两级，先廉价后语义。**

- **一级（MVP，零依赖）**：规范化文本（去空白/小写/去标点）后**精确/近重复**匹配 + 同 `kind`+`scope` 内的 Jaccard/字符相似度阈值。命中则**不新建**，改为在已有记忆上追加一条 `source`（多来源 = 置信度 +）。这解决"claude 和 codex 各说过一次同一件事"的**主场景**。
- **二级（增强，依赖真向量）**：语义近似去重 —— embedding 余弦相似度 > 阈值 → 提示"疑似重复，合并？"，人工裁决，`superseded_by` 记录。

**合并策略推荐**：**不自动物理合并**，用 `superseded_by` 软链 + 保留全部来源。理由（KISS + 可溯源）：物理合并丢来源、不可逆；软链可回溯"这条记忆来自哪几个会话"。

**备选**：纯 AI 去重（把候选和现有记忆一起喂给 LLM 让它判重）。
→ 部分采纳但降级：AI 判重准但慢且花 token，放**二级**当增强；一级用廉价字符匹配挡掉 80% 明显重复。

---

### 1.3 回填 / 注入 —— 怎么把记忆喂回 CLI

这是**最关键的产品决策**，两条路线：

**路线 P（Pull，MCP 主动查）**：rework MCP 暴露 `search_memory` 工具，CLI 需要时自己查。
**路线 W（Write，写文件注入）**：rework 生成/更新项目的 `CLAUDE.md` / `AGENTS.md`，把记忆写进去，CLI 启动即加载。

**推荐：两条都做，但分阶段——MVP 先 P（Pull/MCP），增强再 W（Write/文件），且 W 永远只写受管块。**

理由：
- **P 先做**，因为它**零侵入、零风险、复用已有 MCP 架构**（照 `session_tools.rs` 加一个只读工具即可），且不碰用户的 CLAUDE.md（写文件是不可逆的信任门槛）。CLI 在需要时 `search_memory("这项目的PB字段约定")` 主动拉——按需、精准、省 token。
- **W 后做**，因为写用户配置文件风险高：必须用**受管标记块**（`<!-- rework:memory:start -->` … `<!-- rework:memory:end -->`），只在块内增删、绝不碰用户手写内容，且**幂等**（重复注入不重复追加）。这是与 claude-mem "raw 注入" 的**差异化 + 安全护城河**。

**为什么这是护城河**：claude-mem 等要**每个 host 装插件**（SessionStart 等生命周期 hook）才能注入；rework 走 **MCP + 文件**两条通用路径，**一次配置、喂多个 CLI**，且原料（跨厂商会话）它天然已有，不需要在每个 agent 里插 hook 采集。

**备选（否决）**：只做 W（直接改 CLAUDE.md，不做 MCP）。
→ 否决：写文件是信任高危动作，作为**唯一**路径太激进；且 MCP 路径能做"按需精准检索"，文件注入只能全量塞（污染上下文窗口）。

---

### 1.4 检索 —— 语义 / 关键词（正视 RAG mock 约束）

**推荐：MVP 关键词（Tantivy）优先，语义作为增强项后置。**

- **MVP 检索**：`search_memory(query, scope?, repo_path?, kind?, limit)` 走**关键词匹配**（记忆 `content` 量小，可复用 Tantivy 索引或直接 PB filter + 内存过滤）。**不依赖真向量**，因此 MVP 不被 rig-core spike 阻塞。
- **增强检索**：接入化学反应 spec 里规划的 Rust 侧向量库（rig-core / sqlite-vec），做语义 top-k。**与化学反应 RAG 复用同一套向量基建**，不为记忆单独造一套。

理由：记忆条目是**已提炼的短文本**（≤2000 字符、量级几百到几千条），关键词检索的召回损失远小于对整段会话做 RAG。先关键词能让 MVP **完整闭环**，语义是锦上添花。

**备选（否决）**：等真向量库就绪再做记忆。
→ 否决：这会把护城河功能**锁死在一个未定 spike 上**，违反"能先跑通就先跑通"。记忆的价值 80% 在"有一份去重账本 + 能注入"，不在"语义检索有多强"。

---

## 2. 与既有 `session_extract`(chemistry) / MCP 读会话 的边界（别重复）

**一句话边界：会话是原料，记忆是提炼物；chemistry 沉淀去"工作台产物"（Task/Doc/Event），记忆账本沉淀去"知识断言"（Memory）并回喂 CLI。**

| 能力 | 归属 | 与记忆账本关系 |
|---|---|---|
| 读会话（`list/search/get_session` MCP） | 已有 | 记忆抽取的**上游原料**，直接复用，不改 |
| `session_extract` → Task/Doc/Event 候选（chemistry） | 已设计/部分实现 | **姊妹管线**：同样"抽候选→确认→落库"，但**产物不同**（工作台 vs 记忆）。**共用** `buildContext` + 解析器骨架 + 确认 Dialog 骨架，**不共用** prompt/schema/目标表 |
| `proposals` 主动引擎（chemistry ④-2） | 已设计 | 记忆账本 MVP **不碰主动引擎**（YAGNI）；增强期可让提议引擎也产"记忆候选"，届时复用 `proposals` 表加一个 `kind=memory` |
| RAG 向量库（Rust 侧） | 待 spike | 记忆语义检索**复用**这套，不新建 |

**防重造铁律**：记忆账本**不得**新写会话读取逻辑、不得新写 AI 调用层、不得新写向量库、不得新写确认 UI 框架——全部复用。它的**净新增**只有：一张 `memories` 表、一个 memory 专用 prompt+解析纯函数、一个去重纯函数、一个 `search_memory` MCP 工具、一个 `CLAUDE.md/AGENTS.md` 注入器（增强期）。

---

## 3. 非目标 / YAGNI · 护城河与风险 · 北极星贡献

### 3.1 非目标（本功能明确不做）
- **不做实时 hook 采集**（不学 claude-mem 在每个 host 装 SessionStart/PostToolUse hook）。rework 的差异化正是**离线聚合已有会话**，不侵入 CLI 运行时。
- **不做云同步 / 多机记忆共享**（cmem 那套）。本地优先，单机先行。多机是遥远后话。
- **不做记忆自动写入工作台**（那是 chemistry 的活）。
- **不做记忆的自动增删改**（AI 不得静默改用户记忆库；一切写入过人工闸门；无物理 delete，只 archive）。
- **不做知识图谱 / 记忆间关系建模**（YAGNI；`superseded_by` 一条软链够了）。
- **不做记忆的 LLM 再生成/压缩链**（claude-mem 的 compaction）。MVP 就是"提炼一句话断言"，不搞多层压缩。

### 3.2 护城河 & 被碾压风险（敢正视）

**护城河（真实且可守）：**
1. **原料独占性**：rework 已把 claude+codex 会话**跨厂商聚合**在本地。竞品要拿到 codex 的会话得单独装插件；rework 已经有了。这是**结构性优势**，别人抄不走的是"你已经在做会话管理"。
2. **零 host 侵入的双向注入**：MCP（pull）+ 受管文件块（write），一次配置喂多 CLI，不在每个 agent 插 hook。
3. **可溯源 + 人工闸门**：每条记忆能反跳原始会话；AI 不静默改库。对信任敏感的开发者是差异点（claude-mem 曾被审计出 raw 注入 = prompt injection 风险）。

**被碾压风险（诚实评估）：**
- **风险 H1 — claude-mem 已支持跨 6 家 agent（含 Codex）、83.9k stars、迭代极快**。它的护城河是"生态 + 一键装"。**我们不与它拼采集广度**，拼**"会话管理产品内的一等公民记忆层 + 可视化去重账本 + 溯源"**——它是 CLI 插件，我们是有 UI 的工作台，用户能**看见、编辑、审计**自己的记忆库。
- **风险 H2 — 官方原生记忆**（Anthropic/OpenAI 若把持久记忆做进 CLI 本体）。这是最大的降维打击。**缓解**：官方记忆大概率**厂商内闭环**（Claude 的记忆不喂 Codex）。rework 的价值锚死在**跨厂商**——把 A 厂学到的喂给 B 厂。只要多 CLI 并存，这个价值就在。若官方做了跨厂商开放记忆，则本功能价值大减 → **这是要在 MVP 后复核的战略假设**。
- **风险 H3 — 去重质量差 = 记忆库变噪音**。廉价字符去重会漏语义重复。**缓解**：人工闸门 + 增强期语义去重；宁可少而准。

### 3.3 北极星贡献
rework 北极星是**"让跨厂商 AI-CLI 会话产生复利"**。记忆账本是**最直接的复利放大器**：会话不再是一次性的，它沉淀成可跨 agent 复用的知识，且**越用越厚**。它把"会话管理器"升维成"跨厂商开发记忆中枢"——这是从工具到平台的关键一跃。

---

## 4. 分阶段计划

> 原则：MVP 必须是**能自证价值的最小闭环**（抽 → 去重 → 存 → 查/注入），且**不被真向量 spike 阻塞**。

### 阶段 M0 — MVP：最小可用闭环（抽取 → 去重 → 存 → Pull 注入）

**目标闭环**：从若干会话抽出记忆 → 廉价去重 → 存进 `memories` → CLI 经 `search_memory` MCP 工具查到 → 每条能反跳原会话。

| 任务 | 粗粒度内容 | 依赖 |
|---|---|---|
| M0-1 PB 迁移 `memories` | 照 board.js 建集合 + 字段 + 索引 + owner 规则 | 无（PB 已就绪） |
| M0-2 记忆抽取纯函数 | `MEMORY_EXTRACT_SYSTEM` prompt + `parseMemories`（照 extract.ts） | AI 调用层（已有） |
| M0-3 廉价去重纯函数 | 规范化 + 同 kind/scope 相似度阈值；多来源合并（追加 source） | 无 |
| M0-4 `MemoryReviewDialog` | 照 DistillDialog：候选列表 + kind/scope 可改 + 勾选写入 | M0-1/2/3 |
| M0-5 记忆库浏览/编辑 UI | 列表 + 按 kind/scope/repo 过滤 + archive + 反跳会话 | M0-1 |
| M0-6 `search_memory` MCP 工具 | 照 session_tools.rs：schema + dispatch（关键词过滤，只读） | M0-1；MCP 架构（已有） |
| M0-7 live PB 实测 | 抽取→写→MCP 查全链对真实 PB 实测（遵循项目铁律） | 全部 |

**M0 不做**：文件注入、语义检索、主动引擎、跨机同步。
**M0 验证的假设**：用户愿意花几秒确认记忆候选；`search_memory` 真能让 CLI 拿到有用上下文。

### 阶段 M1 — 增强一：文件注入（Write 路径）

| 任务 | 内容 | 依赖 |
|---|---|---|
| M1-1 受管块注入器 | 生成/更新 `CLAUDE.md`(全局+项目) 与 `AGENTS.md`，只写 `<!-- rework:memory -->` 块，幂等、绝不碰用户内容 | M0 |
| M1-2 scope→目标映射 | global 记忆 → 用户级/项目级；project 记忆 → 对应 repo_path 的文件 | M0-1 |
| M1-3 注入预览 + 确认 | 写文件前 diff 预览，人工确认（写文件是高危动作） | M1-1 |
| M1-4 反向同步侦测 | 侦测用户手改块内内容 → 提示（不静默覆盖） | M1-1 |

### 阶段 M2 — 增强二：语义去重 + 语义检索

| 任务 | 内容 | 依赖 |
|---|---|---|
| M2-1 接入 Rust 侧向量库 | **复用化学反应 RAG 同一套**（rig-core / sqlite-vec） | **rig-core spike 落地**（化学反应前置） |
| M2-2 语义去重（二级） | embedding 余弦相似 → 疑似重复提示 → 人工裁决 → `superseded_by` | M2-1 |
| M2-3 `search_memory` 语义档 | 关键词 + 语义混合排序 | M2-1 |

### 阶段 M3 — 增强三：主动记忆提议（可选，最后）

| 任务 | 内容 | 依赖 |
|---|---|---|
| M3-1 记忆提议 | 会话增量同步后自动跑抽取 → 产 `kind=memory` 提议入 `proposals`（复用 chemistry ④-2 表），人工在建议面板确认 | chemistry `proposals` 引擎就绪 |

**依赖总览**：M0 无硬阻塞（可立即启动）；M1 只依赖 M0；**M2 依赖真向量 spike（与化学反应共享，别重复投入）**；M3 依赖 chemistry 提议引擎。

---

## 5. 必须由用户拍板的决策点

> 以下每点都会实质改变设计/工作量，实现前需明确裁决。

**D1（阻塞 §1.3 · 最重要）——注入路线的顺序与边界**：MVP 先做 Pull/MCP（`search_memory`）、增强再做 Write/文件注入 —— 认可吗？还是要 MVP 就直接写 CLAUDE.md？（推荐：先 Pull，写文件后置且只写受管块。）

**D2（阻塞 §1.1）——记忆粒度**：4 类 kind（fact/preference/decision/convention）+ scope(global/project) —— 够用吗？要不要砍成更简（只 fact+preference）或加类？（推荐：4 类，别再多。）

**D3（阻塞 §1.2）——去重激进度**：MVP 用廉价字符去重（可能漏语义重复），语义去重后置到 M2 —— 接受吗？还是 MVP 就要 AI 判重（更准但慢+花 token）？（推荐：MVP 廉价 + 人工闸门。）

**D4（阻塞 §1.4）——检索基线**：MVP 记忆检索走关键词、不等向量库 —— 认可"先关键词能跑通"吗？（推荐：认可，语义作 M2 增强。）

**D5（战略假设，MVP 后复核）——被官方碾压的止损线**：若 Anthropic/OpenAI 推出**跨厂商开放**的原生记忆，本功能价值大减。是否接受"押注多 CLI 长期并存 + 厂商记忆各自闭环"这个前提？（PM 判断：概率上厂商记忆会闭环，赌得过；但需 MVP 后看官方动向复核。）

**D6（范围）——主动记忆提议（M3）**：是否纳入路线，还是永久 YAGNI？（推荐：先不承诺，M0/M1 验证价值后再定。）

---

## 附：与 claude-mem 的定位对照（竞品参考）

| 维度 | claude-mem | rework 记忆账本 |
|---|---|---|
| 采集方式 | 每 host 装生命周期 hook（SessionStart/PostToolUse…） | **离线聚合已有跨厂商会话**（零 host 侵入） |
| 形态 | CLI 插件 + 可选云(cmem) | **有 UI 的工作台一等公民**（可视化、可编辑、可审计记忆库） |
| 注入 | raw 注入（曾被审计出 prompt injection 风险） | MCP pull + **受管块**写文件（人工确认、可溯源） |
| 去重 | 压缩/observation | 显式**去重账本** + 多来源合并 + 软链溯源 |
| 护城河 | 生态广度 + 一键装 | 会话管理产品内的记忆中枢 + 跨厂商复利 + 溯源 |

竞品资料来源：
- [thedotmack/claude-mem (GitHub)](https://github.com/thedotmack/claude-mem)
- [claude-mem v13 persistent agent memory (Augment Code)](https://www.augmentcode.com/learn/claude-mem-v13-persistent-agent-memory)
- [claude-mem for Codex CLI (cmem.ai)](https://cmem.ai/for/codex)
