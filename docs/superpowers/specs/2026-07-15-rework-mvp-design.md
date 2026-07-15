# rework —— 设计文档（MVP + 北极星架构）

> 版本：v1 · 日期：2026-07-15
> 定位：融合 [retalk](https://github.com/akapril/retalk-claude)（AI 编码 CLI 会话管理器，Rust/Tauri）与 [workavera](https://github.com/xusenlin/workavera)（自托管 AI 工作空间，Go/PocketBase+React）两者**思路**的全新统一产品——**代码借鉴，不硬抄**。
> 本文分两部分：**A. 北极星架构**（记录完整目标形态，作为长期参照）；**B. 第一份 MVP（阶段 0+①）**（本轮真正要实现、要出实现计划的范围）。

---

## 0. 一句话愿景

> **左手管住你所有 AI 编码 CLI 的历史会话与生态配置，右手是一个能"读懂"这些会话、把编码成果沉淀成文档/任务/日历的 AI 工作台。** 会话是"发生了什么"，工作台是"要记住/要做什么"，AI 是催化剂。

与两个原项目的差异化：retalk 只回看过去的会话；workavera 只做通用工作；**rework 让会话成为工作台的一等输入，并让 AI 能看见你的编码历史**。

---

## 0.1 已锁定的前置决策（来自脑暴过程）

| 决策 | 结论 |
|---|---|
| 技术栈 | **Rust + Tauri v2 + React19/TS/Tailwind4/shadcn**，PocketBase 作为打包 **sidecar** 承载数据/认证/实时/权限 |
| 代码复用原则 | 两个原项目**只借鉴设计思路**，不硬抄代码；PocketBase 作为基础设施整体使用；workavera 前端作为脚手架蓝本 |
| 使用场景 | **先个人单机**，架构给"多用户 + web + 团队"预留位（选项④：先跑起来，商业化以后再说） |
| 数据层可替换 | 数据访问藏在接口后（`Repository` trait / 前端 `dataClient` 薄层），未来可换 Postgres/云 |
| 商业化 | 方向未定，先做个人开源版；所选组件许可证均宽松（PocketBase MIT / Tauri MIT-Apache），不阻碍未来 open-core |
| 主题 | **明色为主、明暗双主题、干净中性盘**（沿用 workavera 的 Tailwind4 `@theme`+oklch 机制，**不使用**莫兰迪）；本项目显式覆盖全局莫兰迪偏好 |
| 设计哲学 | 全程 KISS / YAGNI / SOLID |

---

# 第一部分：北极星架构（完整目标形态 · 长期参照）

## A.1 全局结构

```
┌──────────── Tauri v2 App（单一 Rust 二进制 + 打包 PocketBase sidecar）────────────┐
│  React19/TS/Tailwind4/shadcn —— 一个 bundle，两个窗口                              │
│   ├ main 窗口：工作台(会话中枢/Chat/Docs/Board/Calendar/生态/用量)                  │
│   └ spotlight 窗口：全局热键弹窗（失焦即隐，主窗口关着也能用）                        │
│   组件 → Zustand store → 两个网关（组件绝不直接碰 pb/invoke）：                     │
│      lib/pb/*         →→ PocketBase JS SDK：工作台数据/chat/实时                    │
│      lib/tauri/ipc.ts →→ invoke：会话扫描/搜索/恢复/生态（唯一 invoke 出口）         │
│            │                                        │                              │
│     ───────┼── PB JS SDK ──┐              ── Tauri IPC/Event ──┐                    │
│            ▼               │                                   ▼                    │
│    PocketBase sidecar      │                        Rust / Tauri core              │
│    127.0.0.1 · externalBin │◄─reqwest───┐ providers(6+) trait+registry(消4处match) │
│    SQLite+认证+实时+        │ (bootstrap │ Tantivy+jieba 搜索                        │
│    access rules+文件+Admin │  +会话元数据│ ecosystem「生态源」抽象                   │
│    collections:            │  增量同步)  │ terminal：LaunchPlan(纯函数)+spawn        │
│     sessions_meta/tags/... │            │ sync → PB（只同步元数据）                  │
│     docs/board_*/calendar/ │            │ AI：rig-core agent loop，                 │
│     chat_*/llm_models      │            └ 工具持「用户 PB token」→ PB               │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## A.2 六根支柱

1. **栈与底座**：PB 用 Tauri `externalBin` 打包为 sidecar，只绑 `127.0.0.1`，Rust 管其生命周期（spawn / health-check `/api/health` / 优雅退出 / ≤3 次崩溃自恢复）。迁移用 PB 的 JS 迁移文件打包，**不 fork PB 源码**。**单用户免登录**：首启 Rust 建 `local-user`、拿其 auth token 存入 OS keychain 并注入前端，用户看不到登录页；但每张表都写 `owner = @request.auth.id` 的 access rule → **多用户零 schema 改动**。Rust 侧 PB 客户端用 `reqwest` 直连 REST（不引社区 crate），前端用官方 PocketBase JS SDK。

2. **retalk 重生（消灭 4 处 `match provider`）**：把 `SessionProvider` trait 从"只管全量扫描"扩展到覆盖 **全量扫描 + 增量单文件扫描 + 恢复命令 + 时间线回放** 四件事，配 `ProviderRegistry` 路由。散在 `scanner.rs:24`/`updater.rs:120`/`timeline.rs:17`/`terminal.rs:240,277` 的四处分发全部消失 → **新增 CLI 工具只实现一个 trait、注册一行**（OCP/DIP）。顺带接入源码里已有但没接线的 aider/cursor/continue。两个上帝文件按域拆：`commands.rs`(1823行)→8 个域命令模块 + `JsonStore<T>` 消重复 load/save；`ecosystem.rs`(1115行)→`EcosystemSource` trait + `ConfigFormat` 策略（路径/格式/disabled 字段变成**数据声明**而非代码分支）。

3. **数据边界**：工作台数据 + 会话**元数据** + chat → 进 PocketBase；原始会话 transcript + Tantivy 索引 + 生态配置文件 → 留磁盘由 Rust 管。会话元数据靠 `content_hash` 增量 upsert 进 PB `sessions_meta`；**扫描派生字段（Rust→PB 单向覆盖）与用户字段（前端写，Rust 绝不覆盖）严格分离**，避免双写冲突。会话文件消失只标 `orphaned`，不删用户的标签/备注。PB 是可从磁盘重建的投影，同步失败可容忍。

4. **搜索联邦制**：Tantivy（会话，留 Rust 进程，含 jieba 中文分词）与 PB-FTS（工作台内容）**各为真相源**，不合并索引。后端 `search_unified` 命令用 `tokio::join!` 并行查两侧、**分组归一化返回**（`{ sessions:[], workbench:[] }`），前端只见一个搜索框。任一侧失败降级返回另一侧（PB 未起时会话搜索照常）。

5. **AI 权限「白送」（皇冠明珠）**：AI 工具**闭包捕获当前用户的 PB token**，执行时发出带该 token 的 PocketBase API 调用 → **PB 的 collection access rules 就是服务端二次授权**，与人类前端走的是同一份规则。workavera 需手写维护一致性的 Go 领域授权层（`requireProjectOwner`/`requireTaskWriter`）在本方案**整层不存在**——"AI ≤ 用户权限"由 token 天然保证，单一事实来源。破坏性操作**双保险**：① 工具集不注册任何 `*_delete`（动作空间里没有删除）；② PB `deleteRule` 独立兜底。`capabilities` 契约（从用户角色派生，给模型做防御性预判）**只是体验优化，不是安全边界**——安全边界永远是 PB rule。**单用户是"只有一个用户"的实例，不是简化分支**（token/rule 链路不特判、不退化）。
   - **框架**：主选 `rig-core`（多 provider / 类型安全工具 / chunk 流式 / 内建 agent loop 一站满足）；Anthropic thinking 深度控制留 `genai` 作备选后端；用 `LlmProvider` trait 抽象避免绑死。
   - **Anthropic 契约坑（必须正面处理）**：持久化用 provider-neutral 的 flat parts，但重建历史请求时必须满足 ①`tool_use` 后紧跟 `tool_result`（靠持久化 `step-start` 边界、重建时按步分组产出独立 assistant/tool 消息对）②thinking block 带 signature 往返（reasoning part 存 `provider_metadata`，重建时还原）。**历史重建层自己实现，不托付框架默认行为**。专门写"带 thinking + 多步工具的会话往返仍是合法 Anthropic 请求"的单测。

6. **结合的化学反应（灵魂）**：
   - **会话→沉淀闭环**：`sessions_search` 定位会话 → `session_extract`（只读、只产候选：bug/todo/结论/决策，每条带 `source_session_id` + 可回溯 `anchor`）→ 候选以可勾选卡片呈现给用户确认 → `docs_upsert` / `board_create_task` 落库（受 PB rule 授权），沉淀物字段存 `source_session_id` 形成**回跳溯源**。抽取与落库解耦（SRP），中间可人工确认。
   - **会话 RAG**：会话事件写入时生成 embedding（rig 向量库 / sqlite-vec，**Rust 侧**），AI 回答时 `session_search_within` 命中片段 → 内联引用**具体会话 + 具体片段(anchor)** → 前端渲染成"跳转到会话第 N 步"链接。

## A.3 PocketBase Collection 设计（裁剪自 workavera，每表带 `owner` + access rules）

- **users**（PB 内置 auth，扩展 `name`/`avatar`/`status`）：单用户只有 1 条 `local-user`。
- **会话元数据组**：
  - `sessions_meta`：`owner` · `session_id`(unique 外部键) · `provider` · `project_path` · `project_name` · `custom_name`(用户) · `favorite`(用户 bool) · `hidden`(用户 bool) · `last_prompt`(扫描) · `message_count`(扫描) · `total_tokens`(扫描) · `content_hash` · `orphaned`。唯一索引 `(owner, session_id)`。
  - `session_tags`：`owner` · `session_id` · `tag`。唯一 `(owner, session_id, tag)`。
  - `session_notes`：`owner` · `session_id` · `content`。唯一 `(owner, session_id)`。
  - （`project_notes` / `project_pins` 对称，键为 `project_path`。）
- **工作台**：`docs`（含 `revision` 乐观锁 + `doc_versions` 不可变快照 + `doc_pins`）、`board_projects`/`board_states`/`board_labels`/`board_tasks`/`board_members`/`board_templates`、`calendar_events`。规则全套照搬 workavera（单用户下只有 `owner` 分支生效，`board_members` 恒空但让多用户成员传递 rule 零改动激活）。
- **Chat**：`llm_models`（`api_key` hidden，所有 rule=nil，仅经 Rust 受控路径访问）、`chat_conversations`、`chat_messages`（`parts` JSON、`status` streaming/complete/error/cancelled、唯一 `(conversation, sequence)`）。

access rule 统一套路（以 sessions_meta 为例）：
- list/view：`@request.auth.id != "" && owner = @request.auth.id`
- create：`@request.auth.id != "" && @request.body.owner = @request.auth.id`
- update：`owner = @request.auth.id && @request.body.owner:changed = false`
- delete：`owner = @request.auth.id`

## A.4 Rust 模块树（重构目标）

```
src-tauri/src/
  lib.rs                    // 启动/托盘/快捷键/后台线程 + PB sidecar 挂载
  paths.rs                  // AppPaths 抽象（去 retalk 硬编码 ~/.claude/retalk/）
  models.rs                 // + SessionMeta
  pb/{mod,process,client,bootstrap}.rs   // sidecar 生命周期 + reqwest 客户端 + 首启初始化
  repo/{mod,pb_impl}.rs     // SessionMetaRepository trait（唯一 Rust 侧数据抽象）
  sync.rs                   // 扫描结果 → PB 增量同步编排（content_hash / 去抖批量 / rebuild）
  providers/
    mod.rs                  // SessionProvider(扩展版4职责) + ProviderRegistry
    claude/codex/gemini/opencode/kilo/reasonix(+aider/cursor/continue).rs
  scanner.rs                // 委托 registry（无 match）
  updater.rs                // 三策略；监听目录来自 registry（无硬编码）
  indexer.rs                // Tantivy；复用 IndexWriter（不再每次重建）
  search/{mod,model,merge,session_backend(原searcher),workbench_backend}.rs
  timeline.rs               // 委托 provider.read_timeline（无 match）
  terminal/{mod,kind,plan(纯函数可测),spawn(薄IO)}.rs
  ecosystem/{mod,source,jsonc,writer,version, claude/codex/gemini/opencode/kilo}.rs
  store/mod.rs              // JsonStore<T> 消除十余处 load/save 重复
  agent/{mod,provider(rig/genai),tools,history(Anthropic契约重建)}.rs
  commands/{mod,sessions,search,terminal,ecosystem,config,workbench,chat,reports,system}.rs
  tests/ + fixtures/
```

## A.5 前端结构（React，脚手架蓝本 = workavera 前端）

- **双窗口**：`App.tsx` 按 `getCurrentWindow().label` 分派 `<SpotlightApp>`（无路由弹窗）/ `<AppRouter>`（HashRouter 主窗口）。二者共享 store/lib/theme/shadcn，渲染树独立。
- **双网关**（组件永不直接碰 pb/invoke，DIP）：`lib/pb/*`（PocketBase JS SDK + realtime 封装）、`lib/tauri/{ipc,events,window}.ts`（`ipc.ts` 是唯一 invoke 出口，类型化命令契约表）。上 web 时只换 `lib/tauri/*` 实现，store 不动。
- **Zustand 按域拆 store**，每个 store 标注数据源（[PB]/[本地]）。
- **AI 流式**：线上格式用 AI SDK message-parts（复用 workavera 的 reducer + `tool-output` 组件族），传输走**自定义 Tauri-channel 版 transport**（免本地 HTTP/CORS）；保留 `ValidForWire` 结构校验思想。
- **工具输出注册表**：`features/chat/tool-output/registry.tsx` 把 workavera 的 `if(toolName===...)` 链重构成 Map，会话类工具卡（`session-search`/`session-ref`）增量加一行（OCP）。
- **化学反应 UI**：`features/distill/*`（会话→Docs/任务沉淀）、`common/EntityLink`（会话/文档/任务/事件互链 + 悬浮预览 + 直达）。
- **主题**：Tailwind4 `@theme inline` + oklch，`:root`/`.dark` 双主题，**干净中性盘**，语义 token（`--background/--card/--primary/...`）+ 玻璃/Spotlight token（`--glass-surface` 用 `color-mix` 而非裸 rgba）。组件一律 `var(--...)`/语义类，**禁止硬编码颜色**；明主题避免纯白大块/高对比硬边；明暗同等对待。

## A.6 两处已裁决的设计冲突（记录在案）

1. **会话正文存哪**：元数据进 PB `sessions_meta`（带 owner，用于发现 + 授权）；**正文永远留磁盘**，Rust 按需读；AI 会话工具**先查 PB 元数据(受 rule 授权)→再经 Rust 读磁盘正文**；RAG 向量索引放 Rust 侧不进 PB。→ 单一授权源 + 磁盘为正文真相，两者兼得。
2. **AI 流式传输**：线上格式用 AI SDK message-parts（前端整套复用），传输走自定义 Tauri-channel transport（不起本地 HTTP）。→ 免 CORS + 前端复用，两头好处都要。

## A.7 单用户 → 多用户 / web / 团队 演进

- **零改动激活**（因预留 `owner` + access rules）：所有表的行级隔离、Docs 项目文档 / Board 成员协作规则、chat/calendar/会话元数据隔离、AI 工具授权（token+rule 与用户数无关）、capabilities 派生、破坏性双保险。
- **演进时补齐**：认证从"本地免登录"升级为真实多用户登录（PB auth，token 流程从一开始就用真 token 故无临时分支要拆）；会话采集归属（设备→用户绑定）；`activeRun` 注册表 key 扩为 `(user, run_id)`；web 版 `lib/tauri/*` 增 HTTP 变体 + 本地能力优雅降级，Spotlight 降级为应用内命令面板。

---

# 第二部分：MVP（阶段 0 + ①）—— 本轮实现范围

> 原则：**最小可自用**。砍掉一切非必需。Docs/Board/Calendar/完整 Chat/生态面板/用量统计/化学反应**全部不在 MVP**（属阶段 ②③）。

## B.1 阶段 0 —— 地基骨架

**目标**：把三方（Tauri Rust / React 前端 / PocketBase sidecar）打通，两条数据管道各跑通一个探针命令。

范围：
- Tauri v2 + React19/TS/Tailwind4/shadcn 工程起步（HashRouter）。
- PocketBase 以 `externalBin` sidecar 随应用启动；Rust `pb::process` 管生命周期（spawn / health-check / 优雅退出）；`pb::bootstrap` 首启建 `local-user` + 免登录注入 token（keychain）。
- 打包 `pb_migrations/*.js`，首启自动 migrate（至少建出 MVP 需要的 `sessions_meta`/`session_tags`/`session_notes` + `users` 扩展）。
- 前端两网关骨架：`lib/pb/*`（`pb.health()` 通）、`lib/tauri/ipc.ts`（一个探针命令通）。
- `ThemeProvider` + 干净中性盘 token 落地（明暗可切）。
- `MainWindowLayout` + 空侧栏。

**验收**：应用启动 → sidecar 起 → 明暗主题可切且为中性盘 → `pb.health()` 成功 + `ipc.scanSessions()` 返回真实本地会话数据。

## B.2 阶段 ① —— 第一个 MVP：会话中枢 + Spotlight

**范围（最小可自用）**：

*主窗口*
- `MainWindowLayout` + 侧栏（**只放"会话中枢""设置"两项**）。
- **会话中枢** `pages/sessions.tsx`：**项目分组视图**（时间线视图延后）、`SessionCard`、基础元数据（收藏/备注，可先简单写）、`SessionPreviewPane` 简版。
- **搜索**：`store/session-search.ts` **前端过滤**已加载会话（暂不上 Rust/Tantivy 联邦搜索；接口按未来可下沉设计）。
- **恢复**：`RestoreDialog` + `ipc.restoreSessions`（至少"恢复到新终端窗"）。
- **设置** `pages/settings.tsx`：全局热键配置（`ipc.updateHotkey`）、workspace 路径。

*Spotlight 窗口（产品身份，必须进 MVP）*
- 独立 `spotlight` 窗口：全局热键唤起、失焦即隐、`SpotlightInput` 自动聚焦。
- 键盘导航：`↑/↓` 选中、`Enter` 恢复/在主窗口打开预览、`Tab` 切换动作（恢复到新窗 / 作为标签页）、`Esc` 关闭。
- 空查询显示最近会话 + 搜索历史；输入时过滤会话。

*后端（Rust）*
- `SessionProvider` trait 扩展 + `ProviderRegistry`（**本阶段就把 4 职责 trait 立起来**，至少 claude/codex 两个 provider 完整实现，其余可占位）。
- 会话扫描（复用 retalk provider 解析逻辑）+ 更新策略（watcher/poll 至少一种）。
- `terminal` 的 `LaunchPlan`(纯函数) + `spawn`，至少覆盖当前平台（Windows）主终端。
- `sync.rs`：扫描结果 → PB `sessions_meta` 增量 upsert（`content_hash` 去重）。
- 命令按域分模块（`commands/{sessions,terminal,config,workbench}`）。
- **单测**：至少覆盖 §A.4 中的核心纯函数（路径编解码、恢复命令构造、LaunchPlan、query 过滤）。

*PB 打通验证*
- 会话的收藏/标签/备注写入 `sessions_meta`/`session_tags`/`session_notes` 并读回（验证云管道 + access rule 生效）。

**验收标准**：
1. 热键呼出 Spotlight，输入即过滤本机真实会话，键盘选中 `Enter` 恢复一个真实会话；失焦自动隐藏。
2. 主窗口会话中枢按项目分组列出全部本地会话，可搜索、可预览、可恢复。
3. 收藏/备注写入后重启仍在（已落 PB 并按 owner 隔离）。
4. 明暗主题均为干净中性盘、无硬编码色、Spotlight 玻璃层两种主题都不突兀。
5. **关掉主窗口后仅靠 Spotlight 也能恢复会话**（多窗口形态成立）。
6. `cargo test` 通过，覆盖核心纯函数。

## B.3 MVP 明确不做（YAGNI）

AI Chat、Docs/Board/Calendar、生态面板、用量统计图表、时间线视图、联邦搜索（Rust/Tantivy 下沉）、批量操作、导出、会话对比、化学反应（沉淀/RAG）、多用户/登录 UI、web。全部属阶段 ②③④。

---

## C. 开放问题（待定，不阻塞 MVP 实现计划）

1. **产品正式名称**：当前 codename `rework`，是否定名。
2. **主题中性盘的强调色**：是否要一个品牌主色（阶段 0 做 UI 时定）。
3. **rig-core 对 Anthropic reasoning signature 往返的实测支持度**：阶段 ②（AI Chat）开工前需一个 spike 验证，不足则 Anthropic 路径切 genai。
4. **仓库与提交**：`D:/workspace/rework` 当前非 git 仓库，是否 `git init`（本设计文档暂未提交）。

---

## 附：参考素材（只读分析，未修改）

- retalk 源码：`D:/workspace/retalk-claude`
- workavera 克隆：`D:/workspace/_tmp_workavera_analysis`
- 本设计基于 4 份并行 agent 深度调研（PB 集成建模 / retalk 移植 / AI 权限工具 / 前端与阶段）交叉汇总而成。
