# 多机同步引擎 设计 (Multi-Machine Sync Engine)

> 状态：设计定稿待评审 · 2026-08-05 · 内部代号 rework / 产品名 Keelson

## Context（为什么做）

Keelson 是本地优先的单用户桌面应用，数据存在每台机器内置的 PocketBase sidecar。
用户（单人）在**多台自己的机器**上使用，要求**同一份数据**，且**离线也能读写**
（"离线就用不了"不接受）。当前的"远程 PB URL"模式（`BackendSection` 让前端直连远程 PB）
与离线读写天然冲突——前端直连远程，断网即废。

本引擎在既有 PocketBase 投入之上自建**单用户离线优先 LWW 同步**（换后端方案 ElectricSQL/
PowerSync 等已否决：PB 焊死太深）。程序级路线见记忆 `rework-multi-machine-sync-route`：
件一认证瘦身（已并 master `c393f70`）、feat/web-remote（已在 master）之后，本引擎是最后
也是最大最险的一块。

## Goals / Non-goals

**Goals**
- 每台机器本地 PB 权威，离线可读写；联网后自动双向对账收敛。
- 复用既有零件：web 网关 `/pb` 反代 + 配对（`src-tauri/src/web/`）、`PbClient`
  （`src-tauri/src/pb/client.rs`）、`sync.rs` 的 upsert/hash 套路。
- 保留"两种模式"：纯本地单机（默认）/ 同步（opt-in）。

**Non-goals（v1 明确不做）**
- 会话（sessions）不同步：各机只读扫本地 `~/.claude`，会话集互不相同。
- 多主 CRDT：单用户几乎不并发，LWW 足够（KISS）。
- 实时推送（PB realtime 订阅跨机）：v1 用轮询 + 触发，realtime 留后。

## 架构

**核心转变：前端永远只连本地 PB；同步是后台一个 Rust worker。**

```
┌─ Spoke 机器 ───────────────┐         ┌─ Hub 机器（常开）──────────┐
│  前端 ─→ 本地 PB(权威,离线)  │         │  前端 ─→ 本地 PB(权威)       │
│           ↑↓                │  /pb    │           ↑                 │
│  Rust sync worker ──────────┼────────→│  网关(pb_proxy) 反代 ─→ PB   │
│  (PbClient→hub, 配对token)   │ Tailscale│  被动 serve，不跑 worker     │
└────────────────────────────┘         └────────────────────────────┘
```

- **Spoke**：跑自己的本地 sidecar PB（离线权威）+ 后台 Rust sync worker，用 `PbClient`
  指向 hub 网关 `/pb`（配对 token 认证），双向 LWW 对账。前端不知 hub 存在。
- **Hub**：任意一台开了网关、被 spoke 配对连上的常开机。**被动**，只 serve `/pb`，不跑 worker。
- **角色**：一台机器要么 **本地单机**（默认）要么 **spoke**（同步到某 hub）。hub 非显式模式=
  "网关开着 + 被连"。3 台机器=都作 spoke 指同一 hub（星形）。
- 本设计**替代** `BackendSection` 的"前端直连远程 PB"路（那条与离线冲突，予以移除）。

## 同步集合清单（decision①：推荐集）

**参与同步**（按关系应用顺序，父先子后）：
1. `board_projects`
2. `board_project_states`
3. `board_project_labels`
4. `board_project_members`
5. `board_tasks`（引用 project/state/labels）
6. `board_templates` **仅 owner 非空**（内置模板每机迁移自带，不同步免重复）
7. `doc_assets`（**二进制图片**，特殊：见下"二进制资产同步"；须在 `docs` **之前**同步，
   使文档内嵌图片 URL 可解析）
8. `docs`（引用 projects 多对多；正文内嵌 `doc_assets` 文件 URL）
9. `reading_items`
10. `calendar_events`（可选引用 project）
11. `memories`
12. `prompts`

**v1 排除**：`notifications`（临时高频、跨机语义别扭）、`activities`（超高频本机审计流）、
`sessions_meta/session_tags/session_notes`（对本机会话的注解，同步过去成孤儿）。

## 数据模型改动（引擎第 1 步 = 软删除 tombstone）

同步集合各加一个 tombstone 字段：

- `deleted_at`：date 字段，可空。空 = 未删；有值 = 已删（软删）。
- 与既有 `archived`（项目/任务业务归档）、`status`（阅读/记忆业务态）**正交共存**，不复用。
- 迁移：新增 `src-tauri/pb_migrations/<ts>_tombstones.js`，给上述集合逐一 `fields.add(date("deleted_at"))`。

**删除路径改软删**（前端 ~10 处 `lib/pb/*` + store，见调查）：删除 = `patch(id, {deleted_at: now})`
而非 `.delete()`。**关键**：软删 breaks PB `cascadeDelete`——`deleteProject`（`store/board.ts:604`）
原靠 PB 级联删 states/labels/members + 手删 tasks，改后须**应用层手动 tombstone 所有子记录**
（项目→状态→标签→任务→成员 + 处理关联 docs），顺序同上。

**读取过滤**（散落 16+ 处，无统一封装）：所有 list/get 查询注入 `deleted_at = null`：
- 前端：在 `src/lib/pb/collections.ts` 加 `NOT_DELETED = "deleted_at = null"` + `combineFilters(a,b)`
  helper，11 处 `getFullList/getOne`（`lib/pb/*.ts`）逐一并入。
- 后端 Rust MCP：`src-tauri/src/mcp/tools.rs` 6 处查询 filter 并入 `deleted_at = null`。
- 实时订阅 5 处（`store/*.ts` 的 subscribe handler）：收到"update 且 deleted_at 非空"当作删除处理
  （软删经由 update 事件到达，不是 delete 事件）。

**GC**：v1 不清墓碑（单用户低量，永留）；后续按 age 清。

## 同步算法（worker 核心）

复用 `sync.rs` 的 upsert-by-key + 错误隔离套路，扩为双向：

**每集合 watermark**：spoke 本地持久化两个游标（拉/推各一），值 = 上次成功同步到的 `updated` 时间戳。

**一轮 sync（按集合顺序，父先子后）**：
1. **拉（hub→本地）**：`PbClient.list(coll, "updated > '{pull_wm}'", fields)` 分页取增量
   （**修 `PbClient` 的 `perPage 500` 封顶 → 加分页循环**）。对每条按 id upsert 进本地 PB：
   仅当 `remote.updated > local.updated` 才写（LWW）。含 `deleted_at` → 本地也标删。
   全部应用成功后推进 `pull_wm`。
2. **推（本地→hub）**：本地 `updated > push_wm` 的记录，按 id 在 hub upsert：
   仅当 `local.updated > remote.updated` 才写。推进 `push_wm`。
3. 每条错误隔离（单条失败记警告、不中止整轮）；watermark **仅在成功后推进**（失败下轮重试，幂等）。

**LWW 冲突**：比 `updated`（PB autodate onUpdate 自动 bump），谁新谁赢。删除即一次 update
（`deleted_at` 置值同时 bump `updated`），故删-vs-改冲突也走同一 LWW。

**关系顺序**：严格 项目→状态→标签→成员→任务→**doc_assets→docs**，避免子记录引用未拉的父、
文档引用未拉的图片。

### 二进制资产同步（doc_assets 特例）

`doc_assets` 与 JSON 记录不同，须单独处理：
- **字段特殊**：只有 `created`、无 `updated`（文件上传即不可改）。故它是
  **presence-based**：只有"新增"和"删除（tombstone）"，**无 update-LWW**。
  增量游标用 `created`（而非 `updated`）+ `deleted_at`。
- **protected 文件**：`doc_assets.file` 是 `protected:true`，下载须先取文件 token
  （PB `POST /api/files/token`），再 `GET /api/files/doc_assets/{id}/{file}?token=`。
- **`PbClient` 扩展**：现仅 JSON。需加两个方法——`download_file`（取 token + GET 二进制字节）、
  `create_with_file`（multipart POST 上传字节建记录，保留 id 语义按 owner+原 id 判存在）。
- **同步逻辑**：
  - 拉：hub 有本地无的 asset（按 id）→ `download_file` 取字节 → 本地 `create_with_file`。
  - 推：本地有 hub 无的 → 上传。
  - 删：`deleted_at` 传播即可（文件字节可留待 GC）。
- 因 asset 不可改，无内容冲突，只需保证"两边 id 对齐、字节到位"。10MB/张上限沿用现 schema。

## 首次接入（decision③：并集合并）

spoke 首次配对 hub 后：对每个同步集合做一次全量双向对账。两边独立生成的 id 不重叠 →
结果为**并集**（两边数据都留）。同名但各自创建的项目=两份（不自动去重，已知局限）。
不清空任何一边。之后进入常规增量循环。

## 触发与调度

worker 在 Rust（tokio 后台任务，随 app 生命周期）：
- **定时**：spoke 联网时每 N 秒（如 30s）一轮。
- **断线重连**：网络恢复即触发一轮。
- **本地写变更**：本地 PB 有写 → 防抖（如 2s）后触发推。
- hub 不跑 worker。

## 前端改动

- **移除** `BackendSection` 的"远程 PB URL 直连"路（与离线冲突）。
- **新增 spoke 接入 UI**（设置页）：「作为第二台机器连接到 hub」→ 填 hub Tailscale 地址 + 配对码
  → 复用现有 `/pair` 流程 → 存 {hub 地址, 设备 token} → 启动 worker。
- **同步状态角标**：显示 本地单机 / 已连 hub（同步中/已同步/离线/错误）。复用 `ActivityIndicator` 位。
- spoke 端"登出"语义（件一预留）：此处落为「解除与 hub 连接（解除配对）」。

## 失败恢复

- watermark 仅成功后推进 → 中断下轮从断点重试。
- upsert 按 id 幂等 → 重复应用无副作用。
- 单条错误隔离（沿用 `sync.rs`）。
- token 失效（hub 重置配对）→ 停 worker，提示重新配对（复用 web `handleAuthExpired` 思路）。

## 安全

- spoke↔hub 认证 = 既有配对 token（`web/auth.rs`：SHA-256 token_hash、常量时间比较、失败限流）。
- 传输经 Tailscale（HTTPS，见 `docs/web-remote-access.md`）。
- owner 作用域：所有记录 owner-only 规则不变；单用户 owner 一致。
- 配对码/明文 token 不落盘不记日志（沿用现状）。

## 已知局限（v1）

- **时钟偏移**：LWW 依赖各机 `updated` 时间戳可比；单用户几乎不并发，接受小偏移风险。
- **并集重复**：两机各自建的同名记录不自动去重。
- **3 路无 P2P**：仅星形，spoke 间不直连。

## 内部分期（引擎自身拆 4 段，各段独立可测/可合）

- **P1 软删除地基**：tombstone 迁移 + 删除路径改软删 + `deleteProject` 应用层级联 + 16 处读取过滤。
  （行为对用户不变：删除仍"消失"，只是软删）
- **P2 同步 worker 核心**：watermark 增量拉/推 + LWW + 关系顺序 + `PbClient` 分页；先单集合打通，
  再铺全集。**末尾接二进制资产同步**（`doc_assets`：`download_file`/`create_with_file`，presence-based）。
- **P3 spoke 接入 + 状态 UX**：配对即连、首次并集、状态角标、移除旧远程直连路。
- **P4 健壮性**：触发（定时/重连/本地写防抖）、token 失效恢复、错误可观测。

## 测试策略

- **P1**：Rust 迁移 + 前端软删过滤单测（删后列表不含、`deleted_at` 置值）；`deleteProject` 级联软删测。
- **P2**：worker 纯函数单测（LWW 取舍、watermark 推进、分页）；两个本地 PB 实例集成对账（CI ubuntu，
  本地 Windows cargo test 受 `rework-windows-cargo-test-lib` 限制，靠 CI）。
- **P3/P4**：手动多机验证（hub + spoke 两台，Tailscale）；离线改→联网合并端到端。

## 需用户运行时验证（实现后）

- 两台机器 + Tailscale 真机同步；离线各改一条 → 联网后收敛。
- 删除在 A 机 → B 机不复活（tombstone 传播正确）。
- 首次接入并集正确、无数据丢失。
