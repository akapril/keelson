# rework Phase ② · Board（项目管理）+ retalk 结合 —— 设计文档

> 版本：v1 · 日期：2026-07-15 · 分支：`feat/board`（MVP 已合并回 master）
> 定位：**主线功能**。在 MVP 地基（PocketBase sidecar + 会话数据 + 双网关）上做**完整看板（对齐 workavera）+ 与 retalk 会话全结合**。**本阶段无 AI**——"会话→任务"是手动的（带溯源回链）；AI 自动抽取等 Phase ④。
> workavera 参考基准：`D:/workspace/workavera`（Go/PocketBase，借鉴设计不抄码）。Board 分析见本次调研（迁移 `migrations/1783179000_create_board_collections.go`、领域层 `internal/board/*`、前端 `frontend/src/{store/board.ts,components/board/*}`）。

---

## 0. 用户已拍板的范围
- **完整看板对齐 workavera**：项目/任务 + 工作流状态列 + 标签 + 优先级 + 截止日期 + **拖拽排序** + 内置模板 + 成员(单用户留位)。
- **retalk 全结合**：两层项目模型 + 从会话手动建任务(带溯源) + 项目详情看关联会话 + git 状态条。
- 单用户；owner+access-rules 多用户就绪（Phase ⑤ 零迁移激活）。

---

## 1. 关键架构差异（相对 workavera，必须先讲清）

workavera 通过**在进程内扩展 PocketBase**（Go 自定义路由 `POST /api/board/projects` + DAO 跨表事务）来原子创建"项目+状态+标签+成员"，并把 `board_projects.createRule` 设为 `nil`（禁止直接 REST 建）。

**rework 的 PocketBase 是 vanilla sidecar，无法加 Go 路由/hook。** 因此：
- **`board_projects.createRule` 允许 owner 直接创建**（不设 nil）。
- **创建项目 = 前端编排顺序创建**：`create project` → 逐条 `create states`（来自模板）→ 逐条 `create labels`。非跨表原子，但单用户本地可接受；**失败时前端做补偿清理**（删掉已建的半成品 project）。
- workavera 靠 Go hook 做的校验（viewer 拦截、防删被引用的 state、created_by 防篡改、活动日志）——rework 用 **PB access rules + 前端约束** 覆盖能覆盖的；**防删被引用 state** 改为前端在删除前查该 state 下是否有 task（有则禁止）；**活动日志**本阶段不做（见 §7 out-of-scope）。

> 一句话：能靠 PB access rules 表达的授权都靠 rule；workavera 那些 Go-hook 专属逻辑，用前端编排 + rule 近似，单用户场景足够。

---

## 2. PocketBase Collection 设计（JS 迁移，新增一个迁移文件）

> 命名沿用 workavera（snake_case），**TS 类型必须逐字镜像这些字段名**（避免 MVP 那种 `id`/`summary` 契约 bug）。所有表 `owner`/`project` relation + access rules 一步到位写多用户版（成员表空着，Phase⑤ 零迁移）。

### 2.1 `board_projects`
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | text(160), presentable | ✅ | |
| `description` | text(2000) | ❌ | |
| `owner` | relation→users, maxSelect 1 | ✅ | |
| `archived` | bool | ❌ | 默认 false |
| **`repo_path`** | text(500) | ❌ | **retalk 缝合键**：关联本地代码目录；空=纯任务项目 |
| `created`/`updated` | autodate | — | |

Rules（沿用 workavera projectRead，成员传递保留）：
- list/view：`@request.auth.id != "" && (owner = @request.auth.id || board_project_members_via_project.user ?= @request.auth.id)`
- **create**：`@request.auth.id != "" && @request.body.owner = @request.auth.id`（**与 workavera 不同：允许 owner 直接建**）
- update：`owner = @request.auth.id && @request.body.owner:changed = false`
- delete：`owner = @request.auth.id`

索引：普通 `(owner, updated)`；`(owner, repo_path)`（按 repo 查项目）。

### 2.2 `board_project_states`
`project`(relation→board_projects, cascadeDelete) · `name`(text100, presentable) · `color`(text20, hex) · `category`(select: `pending`/`active`/`completed`) · `sort_order`(number, 浮点, 初值 `(index+1)*1024`) · created/updated。
Rules（childRead / projectOwner）：list/view = 项目可见；create/update/delete = `project.owner = @request.auth.id`（update 加 `@request.body.project:changed = false`）。
索引：唯一 `(project, name)`；普通 `(project, sort_order)`。

### 2.3 `board_project_labels`
`project`(cascade) · `name`(text80, presentable) · `color`(text20) · created/updated。Rules 同 states。索引：唯一 `(project, name)`。

### 2.4 `board_tasks`
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `project` | relation→board_projects, cascade | ✅ | |
| `state` | relation→board_project_states | ✅ | |
| `title` | text(240), presentable | ✅ | |
| `description` | text(10000) | ❌ | |
| `priority` | select: `none`/`low`/`medium`/`high`/`urgent` | ✅ | 默认 `none` |
| `rank` | number(浮点) | ❌ | 拖拽排序，见 §3 |
| `due_date` | date | ❌ | |
| `assignees` | relation→users, maxSelect 20 | ❌ | 单用户下通常只有自己；UI 极简 |
| `labels` | relation→board_project_labels, maxSelect 20 | ❌ | |
| `created_by` | relation→users | ✅ | |
| **`source_session_id`** | text(200) | ❌ | **retalk 溯源**：任务来自哪个 CLI 会话 |
| **`source_provider`** | text(40) | ❌ | 溯源会话的 provider（跳转用） |
| **`source_anchor`** | text(200) | ❌ | 会话内锚点（预留，本阶段可空） |
| `created`/`updated` | autodate | — | |

Rules（taskWrite，成员写入保留）：
- list/view：项目可见（owner 或 member）
- create：`@request.auth.id != "" && (project.owner = @request.auth.id || project.board_project_members_via_project.user ?= @request.auth.id)`
- update：同上 `&& @request.body.project:changed = false && @request.body.created_by:changed = false`
- delete：同 create 条件
索引：普通 `(project, state, rank)`。
> **不含** workavera 的 `documents`(→docs) 关联——Docs 模块 Phase② 另做，届时再加此字段。

### 2.5 `board_project_members`（**建表但单用户下空**）
`project`(cascade) · `user`(relation→users) · `role`(select: `admin`/`member`/`viewer`) · created/updated。Rules：`project.owner = @request.auth.id`（create/update/delete）。索引：唯一 `(project, user)`。
> 单用户永远空；它的存在让 §2.1–2.4 rule 里的 `board_project_members_via_project.user ?= @request.auth.id` 在 Phase⑤ 零改动激活。

### 2.6 `board_templates`（迁移里 seed 内置模板）
`name`(text120, presentable) · `description`(text1000) · `owner`(relation→users, 可空=内置全局) · `states`(json, 元素 `{name,color,category}`) · `labels`(json, 元素 `{name,color}`) · created/updated。
Rules：list/view `owner = "" || owner = @request.auth.id`；create/update/delete `owner = @request.auth.id`。索引：唯一 `(owner, name)`。
**Seed（迁移内直接写）**：内置至少 4 套双语模板——`Simple Kanban`/`简易看板`(Backlog/Todo→InProgress→Done)、`Software Development`/`软件开发`(Todo→InProgress→Testing→Done)、`Issue Tracking`/`问题跟踪`。owner="" 全局可见。（可全 seed workavera 那 10 套，实现时照 `boardTemplateSeeds` 裁剪。）

### 2.7 本阶段不建（defer）
`board_task_operation_logs` / `board_project_operation_logs`（活动日志，Phase⑤/审计再做）；task 的 `documents` 关联（Docs 模块做完再加）。

---

## 3. 拖拽排序机制（照搬 workavera，纯前端算）

- **task `rank`**：浮点分数排名（lexorank 数值变体）。新建时 `nextRank = 该 project+state 下最大 rank + 1024`（无则 1024）。
- **拖拽插入**：目标列去掉被拖项后，取 `before`/`after`：两者都有 → `(before.rank+after.rank)/2`；只有前 → `before.rank+1024`；只有后 → `after.rank-1024`；都无 → `1024`。前端**乐观更新** UI → `PATCH {state, rank}` → 成功用服务端值覆盖，失败回滚。
- **状态列 `sort_order`**：上下移动时整列归一化 `(index+1)*1024`，批量 PATCH。
- 库：`@dnd-kit/core` + `sortable` + `utilities`（`PointerSensor` distance 6 防误触；`DragOverlay` 幽灵卡）。

---

## 4. retalk 结合（本阶段主角，全手动）

### 4.1 两层项目模型
- **Tier-0 自动轻量项目** = 会话中枢按 `project_path` 分组视图（MVP 已有，零 PB）。
- **Tier-1 受管 Board 项目** = `board_projects` 记录。两种来源：
  - **从 Tier-0 提升**：会话中枢项目分组上"提升为看板项目" → 前端建 `board_project`，**`repo_path` 自动 set 为该 `project_path`** → 弹模板选择 → 编排创建 states/labels。
  - **独立新建**：Board 页新建，可不填 repo_path（纯任务看板）。

### 4.2 缝合与 join（全前端做）
- join 键：`board_project.repo_path == session.project_path`（字符串外部键，非 PB relation）。
- 前端已有会话数据（`ipc.listSessions()`）+ board 项目（PB SDK）→ 在前端按 repo_path 匹配。

### 4.3 从会话手动建任务（带溯源）
- 会话卡/预览上"建任务" → 弹 task sheet，`title` 预填(会话首条 prompt 截断)，`source_session_id`/`source_provider` 自动带上。
- 选目标项目：若该会话 `project_path` 匹配到某 `board_project.repo_path` → 默认选它；否则让用户选已有项目 / 或先"提升"该 repo 为项目。
- 落库 `board_task`（前端 PB SDK，owner=当前用户，created_by=自己）。

### 4.4 项目详情 = 指挥面板
Board 项目详情页同屏：**看板（任务列，dnd-kit）** + **右侧"关联会话"栏**（前端按 repo_path 过滤出的 retalk 会话卡，可预览/恢复/建任务）+ **顶部 git 状态条**（当前分支 + 未提交数）。

### 4.5 双向跳转（溯源回链）
- 任务卡若有 `source_session_id` → 显示"来源会话"徽标 → 点击跳会话中枢定位该会话（用 `EntityLink` 统一组件）。
- 会话详情可显示"催生的任务"（前端按 `source_session_id` 反查 board_tasks）。

### 4.6 需要的 Rust 新增
- **`git_info(project_path: String) -> GitInfo`** Tauri 命令：移植 retalk `get_project_git_info`（当前分支 + 未提交变更数）。`GitInfo { branch: Option<String>, dirty_count: u32 }`。加进 `commands/`（新 `commands/git.rs` 或并入 sessions）。**纯 IO，可对固定仓库写单测（用临时 git repo）。**
- 其余 Board CRUD **无需 Rust**——前端经 PB JS SDK 直连（用户 token → access rules 授权），沿用 MVP favorites/notes 的前端写模式。

---

## 5. 前端架构（借鉴 workavera，隔离规则不变）

### 5.1 目录（新增）
```
src/pages/board.tsx                      # 入口，路由 /board，?project=<id> 控制详情
src/features/board/
  KanbanBoard.tsx                        # DndContext + 项目/看板容器
  ProjectColumn.tsx / StatusColumn.tsx   # 项目行(可折叠) / 状态列(useDroppable + SortableContext)
  TaskCard.tsx                           # useSortable，展示 labels/priority/due/来源会话徽标
  TaskSheet.tsx                          # 任务新建/编辑(state/priority/labels/due/description/来源)
  ProjectSheet.tsx                       # 项目设置(states/labels/模板/repo_path/归档)
  LinkedSessionsPanel.tsx                # 项目详情右侧：按 repo_path 过滤的会话卡
  GitStatusBar.tsx                       # git 分支 + 未提交数
  PromoteToProjectDialog.tsx             # 会话中枢"提升为看板项目"(选模板+set repo_path)
  CreateTaskFromSessionDialog.tsx        # 会话"建任务"(带 source_session_id)
src/store/board.ts                       # useBoardStore(Zustand)
src/lib/pb/collections.ts                # + COL.boardProjects/States/Labels/Tasks/Members/Templates
src/types/board.ts                       # BoardProject/State/Label/Task/Member/Template —— 逐字镜像 PB 字段
```

### 5.2 store（`useBoardStore`，借鉴 workavera `store/board.ts`）
状态：`templates/projects/openedProject/states/todos/openedTask/labels/members/loading/error`；分页(每页项目数)；模块级 `expandedProjectId`。
- CRUD 走 `lib/pb/collections.ts`（**组件不直接碰 `pb.collection`**，隔离规则同 MVP）。
- 拖拽 `moveTodo` 乐观更新 + 回滚（§3）。
- **PB realtime 订阅**：`pb.collection(x).subscribe('*', cb, {filter})` 单窗口下可选，先做基础订阅让多窗口/未来多端一致（YAGNI：可先只订阅当前打开项目的 tasks/states）。
- git：`ipc.gitInfo(repoPath)`（唯一 invoke 出口 `lib/tauri/ipc.ts` 加一个方法）。

### 5.3 主题/隔离/契约
- 颜色全语义 token（含状态列/标签的 hex color 来自数据字段，渲染为 `style={{background: color}}` 是允许的——那是**用户数据**不是主题硬编码；但 UI 框架色仍走 token）。
- `invoke` 只在 `ipc.ts`；`pb.collection` 只在 `lib/pb/*`。
- `src/types/board.ts` 字段名**逐字**对齐 §2 的 PB 字段（snake_case：`repo_path`/`sort_order`/`due_date`/`created_by`/`source_session_id`…）。
- 侧栏加导航项"看板"。

---

## 6. 数据边界 & 权限
- Board 项目/状态/标签/任务/成员/模板 → **PocketBase**（用户资产、可编辑、多用户就绪）。
- 会话本身 → 留磁盘由 Rust 扫描（仅 `sessions_meta` 进 PB）；关联靠 `repo_path` 字符串。
- 写授权：前端持用户 PB token → PB access rules 二次授权（与 MVP 一致）。无破坏性后端命令。

---

## 7. 本阶段明确不做（YAGNI / defer）
活动日志(operation_logs)、成员管理 UI(表建但空)、所有权转让、task↔docs 关联(Docs 模块未建)、assignees 富交互(字段留、UI 极简)、AI 自动从会话抽 bug/todo(Phase④)、Dashboard 总览、跨表原子事务(改前端编排+补偿)。

---

## 8. 验收标准（GUI 项人工，逻辑项自动）
1. 能新建 Board 项目（选模板→自动建 states/labels），能建/改任务、设优先级/标签/截止。☐ 人工
2. **拖拽**任务跨列/列内改序，rank 正确、乐观更新+失败回滚。☐ 人工
3. 从会话中枢"提升"一个 repo 为 Board 项目（repo_path 自动缝合）。☐ 人工
4. 从某会话"建任务"，任务带 `source_session_id`，任务卡显示来源徽标、点击跳回会话。☐ 人工
5. Board 项目详情右侧显示该 repo 的关联会话 + 顶部 git 分支/未提交数。☐ 人工
6. 明暗主题均正常、无框架硬编码色；`invoke`/`pb.collection` 隔离；`board.ts` 类型逐字对齐 PB 字段。☐ 人工+审查
7. `cargo test`（含 git_info 单测）+ `pnpm test` 全绿；关键 PB 写路径（建项目/建任务/拖拽 PATCH）**对 live PB 实测**通过（防 MVP 那类字段/rule 契约 bug）。☐ 自动+实测

---

## 9. 开放问题
1. 模板 seed 全 10 套还是精选 4 套（实现时定，倾向精选双语 4 套起步）。
2. realtime 订阅本阶段做多少（倾向：只订当前打开项目，YAGNI）。
3. "建任务"若会话 repo 未提升为项目：是强制先提升，还是允许挂到任意已有项目（倾向：允许选任意项目 + 一键提升入口）。

---

## 附：workavera 参考文件（实现时对照，`D:/workspace/workavera/`）
- 迁移/schema：`migrations/1783179000_create_board_collections.go`（含 `boardTemplateSeeds`）
- 领域命令/查询：`internal/board/{commands,queries}.go`（可见性/capabilities 语义）
- 前端 store：`frontend/src/store/board.ts`（moveTodo 乐观更新、rank 计算、realtime）
- 前端组件：`frontend/src/components/board/{kanban-board,status-column,todo-card,todo-card-sheet,project-sheet}.tsx`（dnd-kit 用法）
