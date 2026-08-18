# Issues 视图深化设计文档

> 状态：设计已与用户确认，待 review。
> 新一轮（agent-中心 IA 蓝图 S1-S6 已收官后的独立方向）。把任务容器补全为 Multica/Linear 式多视图。
> 目标：现有「看板 + 列表雏形」→ 加 **泳道**（看板二级分组）、**截止日时间线**、**保存视图**（命名视图配置，PB 持久化、可跨机同步）。

## 背景

S1 给了看板(KanbanBoard) + 列表(BoardListView)，BoardSurface 在二者间切（board-view store，只存 view type）。筛选模型已在（`task-filter.ts`：`TaskFilter = {query, labels[], priority}` + `taskMatchesFilter`/`EMPTY_FILTER`）。任务字段丰富：`state`(列)、`priority`、`due_date`、`assignees[]`(人)、`labels[]`、`agent_provider/agent_id`。states/labels 均**项目级**（有 `project` 字段）。

## 决策（已确认）

1. **三块全做**：泳道 + 截止日时间线 + 保存视图。
2. **统一「保存视图」概念**：一个 Saved View = {名称, 视图类型(看板/列表/时间线), 筛选, 泳道分组}。泳道/时间线是"视图选项"，保存视图持久化整套。
3. **保存视图存 PB**（`board_views` 集合，owner+project，软删可跨机同步，契合未来同步 P2）。
4. **时间线 = 截止日**（不加 start_date/真甘特；无 due 的进「未排期」）；**支持拖拽改 due**。
5. **泳道多值字段(assignee/label)**：任务在**每个匹配泳道都出现**（Linear 式，卡可重复）+「无」泳道。单值(priority/agent)干净。
6. 保存视图**不跨项目**（引用项目级 states/labels）。

## 架构核心：`board-view` store 升为「当前视图配置」单一真源

现 `useBoardViewStore` 只存 `view: "kanban"|"list"`。扩为当前视图配置的单一真源：

```ts
type BoardView = "kanban" | "list" | "timeline";
type SwimlaneKey = "none" | "priority" | "assignee" | "label" | "agent";

interface BoardViewState {
  viewType: BoardView;            // localStorage 持久化（项目无关，沿用现状）
  filter: TaskFilter;             // 当前筛选（临时工作态，切项目重置）
  swimlane: SwimlaneKey;          // 当前泳道分组（临时工作态，切项目重置）
  setViewType/setFilter/setSwimlane: ...;
  applyConfig(cfg): void;         // 保存视图点击时灌入整套 config
  resetForProject(): void;        // 切项目时 filter→EMPTY、swimlane→none（避免引用旧项目 label id）
}
```

- KanbanBoard 的 `filter`（现本地 `useState`）**提升到 store**；`useDeferredValue` 仍本地派生保持击键跟手。搜索框/筛选下拉改调 store setter。
- BoardListView / 新 TimelineView 读 store `filter`。
- **切项目**：`ProjectWorkspace` 在 `openedProjectId` 变化时调 `resetForProject()`（filter/swimlane 引用项目级数据，跨项目无意义）。`viewType` 不重置（项目无关）。
- `agentOnly`/`showArchived` 保持 KanbanBoard 本地临时开关（**不**纳入保存视图，YAGNI；可后扩）。
- **好处**：保存视图只需序列化/反序列化这份 config。

## A. 泳道（看板二级分组）

- `SwimlaneKey = none | priority | assignee | label | agent`（默认 none=现状扁平，零回归）。
- 看板**列仍是 state**；开泳道后：整板按 swimlane 维分若干**横向泳道带**，每带内是原来的 state 列 + 卡。
- **纯函数** `groupBySwimlane(tasks, key, ctx) -> { laneId, laneLabel, taskIds }[]`（ctx 提供 labels/priority 元数据取显示名与顺序）：
  - 单值(priority/agent)：一任务一带；priority 按 `PRIORITY_ORDER`，agent 按 provider/名。
  - 多值(assignee/label)：一任务进**每个**匹配带 + 一个「无」带（空数组时）。
  - 空维度值统一归「无」带（排最后）。
- KanbanBoard 渲染：swimlane==="none" 时不变；否则外层 map 泳道带，每带内复用现有 StatusColumn 布局（带内按 laneId 过滤任务）。卡在多带重复出现属预期。
- 泳道下拉在 BoardSurface 工具条（仅 viewType==="kanban" 时显示）。
- 单测：`groupBySwimlane` 各维度 + 多值重复 + 「无」带 + 排序。

## B. 截止日时间线（新 TimelineView）

- 新 `src/features/board/TimelineView.tsx` + 纯函数 `src/features/board/timeline-bucket.ts`。
- `bucketByDue(tasks, granularity) -> { bucketKey, label, start, end, tasks }[] + unscheduled: BoardTask[]`：
  - 按 `due_date` 归桶（granularity 周/月；MVP 默认周）；无 due 的入 `unscheduled`。
  - 桶按时间升序；桶内任务按 due 再按 rank。
  - 日期比较用 ms（参照 [[rework-work-report-generator]]：PB 空格 vs T 分隔不可字典序比）。
- 渲染：时间轴（周/月刻度列）+ 每桶任务卡；顶部「未排期」区列无 due 任务。granularity 切换（周/月）。
- **拖拽改 due**：卡拖到另一桶 → `updateTask(id, { due_date: <桶代表日> })`（复用 store，失败重抛+toast）。dnd-kit（复用收藏拖拽范式，6px 阈值）。
- 只应用当前 `filter`（读 store）。
- 单测：`bucketByDue` 归桶/未排期/排序/边界（跨周月）。

## C. 保存视图（PB）

### C1. 迁移 `src-tauri/pb_migrations/1786600000_board_views.js`
- 集合 `board_views`（本地定义 rel/text/sel/json/auto 助手，参照 `1720000100_board.js`）：
  - `owner` rel(users, required, cascade) · `project` rel(board_projects, required, cascade) · `name` text(required, 160) · `view_type` select(["kanban","list","timeline"]) · `filter` json(maxSize 8192) · `swimlane` select(["none","priority","assignee","label","agent"]) · `sort_order` num · `deleted_at` text(空=未删) · `created`/`updated` autodate。
  - 访问规则 owner-only：`project.owner = @request.auth.id`（listRule/viewRule/createRule[@request.body...]/update/delete，参照现有 board 表）。
  - 索引 `idx_board_views_project`(project, sort_order)。
  - down：删集合。
- 不预置默认视图（YAGNI；当前临时视图始终可用，保存视图为附加）。

### C2. 前端数据层
- `src/types/board-view-saved.ts`：`SavedBoardView { id, project, name, view_type, filter, swimlane, sort_order, deleted_at?, created, updated }`。
- `src/lib/pb/board-views.ts`：`listSavedViews(projectId)` / `createSavedView(...)` / `updateSavedView(id, patch)` / `softDeleteSavedView(id)`（NOT_DELETED 过滤，tombstone 范式）。
- `src/store/board-views.ts`：加载/CRUD，乐观更新**写失败重抛+toast**（参照 [[rework-store-swallow-errors]]，不吞错）。

### C3. BoardSurface 工具条
- 视图类型切换：看板 / 列表 / **时间线**（三选，改 store `viewType`）。
- 泳道下拉（仅看板）：无/优先级/负责人/标签/agent（改 store `swimlane`）。
- 保存视图下拉：列本项目已存视图（点击 `applyConfig` 灌入 store）+「保存当前为新视图」（弹名称 → createSavedView 存当前 config）+ 每项改名/删。
- 视图区三选一：`viewType==="kanban" ? <KanbanBoard/> : viewType==="list" ? <BoardListView/> : <TimelineView/>`。

## 数据流

工具条/筛选框 → 改 board-view store（viewType/filter/swimlane）→ 三视图组件读 store 渲染 → 「保存当前」= 序列化 store config 存 PB `board_views` / 点已存视图 = 反序列化 `applyConfig` 灌回 store。切项目 → `resetForProject()`。

## 明确不做（YAGNI / 边界）

- 不加 `start_date` / 真甘特（依赖/里程碑）——留后独立子项目。
- 泳道只作用**看板**（列表保持 state 分组、时间线按日期分桶）。
- `agentOnly`/`showArchived` 不纳入保存视图（保持 KanbanBoard 本地临时开关）。
- 不做视图共享/协作（单用户）。
- 保存视图不跨项目。
- 时间线不做资源曲线/负载视图（只排任务）。
- 不改任务模型（除已有 due_date 外零字段变更）。

## 约束（继承全局）

- 中文注释；不硬编码（视图类型/泳道键/granularity 用具名常量）。
- store 写失败重抛+toast（board-views CRUD、拖拽改 due）；参照 [[rework-store-swallow-errors]]。
- 迁移沿用 owner-only + 软删/tombstone + json maxSize 范式；owner 播种不涉及（用户自建视图，非 automigrate 早于 local-user 的问题）。
- 日期比较用 ms 不字典序（[[rework-work-report-generator]]）。
- TDD：`groupBySwimlane`/`bucketByDue` 纯函数先写失败测试。
- 子进程/系统调用无涉及（纯前端 + PB 迁移）；Rust 侧零改动（除非误触）。
- tsc 通过；vitest 过。提交不加 `Co-Authored-By: Claude` 尾注。
- 只 git add 各 Task 确切文件，严禁 -A（工作区有未跟踪 spec/plan + 私有 docs/promotion/）。

## 测试

- 纯函数：`groupBySwimlane`（5 维 + 多值重复 + 无带 + 排序）、`bucketByDue`（归桶/未排期/周月/跨界/排序）。
- 手验（GUI）：三视图切换；泳道各维度（多值卡重复+无带）；时间线归桶+未排期+拖拽改 due 落库；保存当前视图→重开/切项目→再点该视图正确还原(viewType+filter+swimlane)；切项目 filter/swimlane 重置；保存视图 owner-only、软删。

## 文件影响

- `src/store/board-view.ts`（扩为当前视图配置真源 + resetForProject/applyConfig）。
- `src/features/board/KanbanBoard.tsx`（filter 提升读 store + 泳道渲染）。
- `src/features/board/swimlane.ts`（新，`groupBySwimlane` + 测）。
- `src/features/board/TimelineView.tsx`（新）+ `timeline-bucket.ts`（新，`bucketByDue` + 测）。
- `src/features/board/BoardSurface.tsx`（工具条：视图类型三选 + 泳道下拉 + 保存视图下拉）。
- `src/features/board/BoardListView.tsx`（读 store filter；state 分组不变）。
- `src/features/board/ProjectWorkspace.tsx`（切项目调 resetForProject）。
- 新 `src-tauri/pb_migrations/1786600000_board_views.js`。
- 新 `src/types/board-view-saved.ts` + `src/lib/pb/board-views.ts` + `src/store/board-views.ts`。
- i18n（shell/board ns，zh/en）：视图类型「时间线」、泳道维度标签、保存视图菜单文案、未排期、granularity。

## 分期（单一 plan，四阶段）

1. **store 重构**：board-view store 扩为 {viewType, filter, swimlane} + applyConfig/resetForProject；KanbanBoard filter 提升读 store；BoardListView 读 store；ProjectWorkspace 切项目 resetForProject。（地基，不加新视图/泳道——先把现状搬到 store 且零回归）
2. **泳道**：`groupBySwimlane`(TDD) + KanbanBoard 泳道渲染 + BoardSurface 泳道下拉 + i18n。
3. **时间线**：`bucketByDue`(TDD) + TimelineView(渲染+拖拽改 due) + BoardSurface 视图类型加「时间线」+ i18n。
4. **保存视图**：迁移 board_views + types/pb/store + BoardSurface 保存视图下拉(列/存/改名/删/应用) + i18n。
