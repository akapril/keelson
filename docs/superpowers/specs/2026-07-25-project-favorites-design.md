# rework「项目收藏」设计 (Project Favorites)

> 状态：设计已与用户确认，待写实现计划。
> 背景决策见记忆 `rework-ia-project-favorites`（grilling 定的 IA 方向）。

## 目标

解决日常痛点「进某个项目路径太深、点击多次」：Notion 式**项目级收藏**——给项目加星，收藏的项目固定在侧边栏顶部「收藏」组，一键打开，落点复用已有的「记住上次 tab」。

## 范围

**做**：项目级收藏（加星/取消）、侧栏顶部「收藏」组（手动拖拽排序）、卡片星标 + 右键菜单两个入口、点击一键开项目。

**明确不做（YAGNI）**：键盘/Spotlight 搜项目、收藏「项目+具体 tab」、收藏数封顶、跨类型收藏（文档/会话）、会话中枢降级（另立一轮设计）。

## 核心决策（已确认）

| 维度 | 决策 |
|---|---|
| 收藏粒度 | **项目级**（非项目+tab）；落点交给已有 `resolveInitialTab` |
| 加星入口 | 项目卡片**星标按钮**（已收藏常亮 / 未收藏 hover 显示）**+** 右键菜单「收藏/取消收藏」（次要入口） |
| 收藏区位置 | 侧边栏**最顶部**独立「收藏」组（在「工作区」组之上） |
| 排序 | **手动拖拽**（复用 dnd-kit + `rankBetween`） |
| 存储 | `board_projects` 加 `pinned`(bool) + `pin_rank`(number)，owner 自动隔离 |

## 数据模型

在既有 `board_projects` 集合加两个字段（**不新建集合**）：

- `pinned`：`bool`，默认 false。`true` = 已收藏。
- `pin_rank`：`number`，收藏项之间的排序键（浮点，复用 `board-rank.ts` 的 `rankBetween` 数值变体）。

**为什么两个字段而非一个**：rework 的 rank 是浮点数（`rankBetween(undefined, 1024) === 0`），若用「pin_rank 为空/0 = 未收藏」当哨兵，拖到最顶会算出 0 与哨兵撞车。故用独立 `pinned` bool 表达「是否收藏」，`pin_rank` 只管顺序——与 board 任务「有 state 也有 rank」同构。

迁移（对齐 `1720000100_board.js` 的 `bool()/num()` 助手风格），新增一支 `172xxxxxxx_project_pin.js`：给 `board_projects` 加 `pinned`、`pin_rank` 两字段；down 迁移移除。

`BoardProject` 类型（`src/types/board.ts`）加 `pinned?: boolean` 与 `pin_rank?: number`。

## 前端：board store

在 `src/store/board.ts` 增：

- **派生 `pinnedProjects`**：`projects.filter(p => p.pinned).sort((a,b)=>(a.pin_rank??0)-(b.pin_rank??0))`。消费侧用 `useMemo`（避免 render 内重算，沿用本仓 perf 惯例）。
- **`toggleProjectPin(id)`**：
  - 未收藏→收藏：`pinned=true`，`pin_rank = nextRank(当前最大 pin_rank)`（追加到收藏末尾）。
  - 已收藏→取消：`pinned=false`（`pin_rank` 保留、忽略即可）。
  - 乐观更新本地 → `updateProject(id, patch)` 写 PB → **失败回滚 + `throw` + 由调用点 toast**（沿用本轮已统一的 store 重抛范式）。
- **`reorderPin(id, toIndex)`**：按目标位置取前后邻居的 `pin_rank`，`rankBetween(before, after)`，单条 `updateProject(id, { pin_rank })`；同样乐观 + 重抛。

复用现有 `updateProject`（已重抛）。不新建 store。

## 前端：UI

**1. 项目卡片星标**（`src/features/board/ProjectList.tsx` 的 `ProjectCard`）
- 名称行右侧加一个星标 icon 按钮：`p.pinned` 时实心常亮；未收藏时默认淡、卡片 hover 才显。
- `onClick` 阻止冒泡（不触发打开卡片），调 `toggleProjectPin(p.id).catch(toast)`。
- 右键 `ContextMenu` 加一条「收藏 / 取消收藏」，与现有「归档」并列。

**2. 侧栏「收藏」组**（侧栏组件，`navigation.ts` 之外的动态区）
- 在渲染静态 `navGroups` **之前**插一个动态分组，标题「收藏」。
- 数据源 = board store 的 `pinnedProjects`。**空收藏 → 整组不渲染**。
- 每条：星/项目图标 + 项目名（截断）；点击 = 打开项目（见下）。
- 拖拽排序：复用 `@dnd-kit`（board 已在用），拖放 → `reorderPin`。
- 侧栏需保证 board 数据已加载（`loadProjects` 已在 App 启动/board 页触发；若侧栏独立于 board 页也需订阅，确保 `pinnedProjects` 可用——实现计划核实加载时机）。

**3. 打开项目流**
- 点击收藏项 → `openProject(id)` + 导航到 `/board`（与 `ProjectCard.handleOpen` 同路径）。
- `ProjectWorkspace` 挂载时 `resolveInitialTab(paramTab, projectId)` 自动落到该项目上次停留 tab。**无新落点逻辑**。

## 错误处理

所有写操作（toggle、reorder）：乐观更新 → 失败回滚本地 → `throw` → 调用点 `.catch(e => toast.error(...))`。与全项目一致，无静默吞错。

## 测试

- **纯函数**（已有 `board-rank.test.ts` 覆盖 `rankBetween/nextRank`，无需重测）。
- **store 单测**：`toggleProjectPin`（收藏追加 rank、取消置 pinned=false）、`reorderPin`（rankBetween 落点）——mock `updateProject`，断言乐观 patch 与失败回滚+重抛。
- **组件**：侧栏收藏组空态不渲染、按 pin_rank 排序、点击触发 open；卡片星标态随 `pinned` 切换。

## 单元边界（isolation）

- `board-rank.ts`：排序算法（已存在，纯函数）。
- `board store`：pin 状态 + 写 PB（`pinnedProjects` / `toggleProjectPin` / `reorderPin`）。
- `ProjectCard`：加星 UI 入口。
- 侧栏收藏组：展示 + 拖拽 + 打开。
- `project-tab-pref.resolveInitialTab`：落点（已存在，复用）。

各单元通过明确接口通信（store 方法 / 派生值），可独立测试。

## 不改动

- `navigation.ts` 静态 `navGroups` 结构不动（收藏是其外的动态区）。
- `resolveInitialTab` / 全局默认 tab / 每项目 tab 记忆：复用，不改。
