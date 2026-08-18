# 真甘特（start_date + 甘特视图）设计文档

> 状态：设计已与用户确认，待 review。
> 独立新一轮，承接已合 master 的「Issues 视图深化」（桶式 TimelineView）。见 [[rework-issues-views-deepening]]。
> 目标：给任务加开始日期，新增第 4 视图「甘特」——连续时间轴 + 每任务一横条(start→due)，支持拖拽移位/拖边缘改期。只做甘特条，不做依赖/里程碑（YAGNI）。

## 决策（已确认）

1. **只做甘特条**：start_date + 甘特视图 + 拖拽移位/缩放。不做依赖关系（depends_on/箭头/防环）、不做里程碑。
2. **甘特 = 新增第 4 视图**（viewType 加 `gantt`）；保留桶式 TimelineView，四选一。
3. **条语义**：`barStart = start ?? due`、`barEnd = due ?? start`；两者皆无 → 「未排期」区。
4. **拖拽自定义像素↔日期数学**（非 dnd-kit droppable，连续定位更合适）。
5. 甘特行**扁平排序**（不按 state 分组）；start>due 不硬校验。

## 现状基线

- `board_tasks.due_date` = PB `date` 字段（`1720000100_board.js:117` `date("due_date")`）。加字段迁移范式有现成 `date`/`text` 等本地助手。
- `board_views.view_type` = select，values `["kanban","list","timeline"]`（`1786600000_board_views.js`）——加 gantt 须改此 select。
- `BoardView` union（`src/store/board-view.ts`）= `"kanban" | "list" | "timeline"`；`initialViewType()` 校验放行 list/timeline。加 gantt 须同步 union + 校验。
- `BoardTask`（`src/types/board.ts`）有 `due_date?: string`；加 `start_date?: string`。
- TaskSheet（`src/features/board/TaskSheet.tsx`）：`dueDate` state + `DatePicker`（value/onChange "yyyy-MM-dd" 字符串，`date-fns`），保存 `due_date: dueDate || undefined`。
- TimelineView（`src/features/board/TimelineView.tsx`）：桶式；`fmtUtcDate(ms)`→"YYYY-MM-DD" UTC 辅助可复用。
- `updateTask(id, patch)`（store/board.ts）：乐观+失败回滚**重抛**。
- BoardSurface：VIEWS 分段控件 kanban/list/timeline，四态分发点。
- board-view store：当前视图配置真源 `{viewType, filter, swimlane}`。

## A. 数据模型

### A1. 迁移 `src-tauri/pb_migrations/1786700000_gantt.js`
- up：
  1. `board_tasks` 加 `start_date`（`new Field({name:"start_date", type:"date"})`，可选，幂等：已有则跳过）。
  2. `board_views.view_type` select values `["kanban","list","timeline"]` → 加 `"gantt"`（取 field 改 values save，幂等：已含则跳过；参照 `1786500000_prompt_skill.js` 的 select 改值范式）。
- down：删 board_tasks.start_date 字段；board_views.view_type values 还原去 gantt（best-effort try/catch）。
- 时间戳 `1786700000` > 现最新 `1786600000`。

### A2. 类型
- `src/types/board.ts`：`BoardTask` 加 `start_date?: string`。
- `src/store/board-view.ts`：`BoardView` union 加 `"gantt"`；`initialViewType()` 校验加 gantt（`v === "list" || v === "timeline" || v === "gantt"`）。

## B. TaskSheet 加开始日期

- `TaskSheet.tsx`：加 `startDate` state（回填 `task.start_date ?? ""`，重置空）。
- due DatePicker **之上**加 start DatePicker（`t("sheet.fieldStartDate")` 标签，同 placeholder 范式）。
- 保存（创建 + 更新两处）加 `start_date: startDate || undefined`。

## C. 甘特布局纯函数（`src/features/board/gantt-layout.ts`）

```ts
type GanttGranularity = "day" | "week" | "month";

interface GanttRange { startMs: number; endMs: number; } // 轴覆盖范围（含所有条 + padding）

interface GanttBar {
  taskId: string;
  barStartMs: number;  // start ?? due
  barEndMs: number;    // due ?? start（单端时 == barStartMs，渲染最小 1 格宽）
  leftPct: number;     // 相对轴范围的左偏移%（0..100）
  widthPct: number;    // 相对轴范围的宽度%（最小一格）
}

/** 任务日期 ms（无效/空 → null）；复用 UTC 解析（.replace(" ","T")）。 */
function taskDateMs(dateStr?: string): number | null

/** 计算轴范围：所有有日期任务的 [min barStart, max barEnd] + 两侧 padding（按 granularity 对齐）。空 → 以 nowMs 为中心一段。 */
function ganttRange(bars: {barStartMs:number;barEndMs:number}[], granularity, nowMs): GanttRange

/** 单任务条几何：barStart/barEnd + leftPct/widthPct（相对 range）。start/due 皆无 → null（归未排期）。 */
function barGeometry(task, range, granularity): GanttBar | null

/** 像素↔日期（拖拽用）：给轴总宽 px + range，pixel→ms 与 ms→pixel 往返一致。
 * dateAtPixel 结果**对齐到 UTC 当天 00:00**（天精度，与视觉 granularity 无关——granularity 只是缩放）。 */
function dateAtPixel(px: number, axisWidthPx: number, range: GanttRange): number  // → 天对齐 UTC ms
function pixelForDate(ms: number, axisWidthPx: number, range: GanttRange): number

/** 布局：过滤出有日期任务→bars（按 barStart 再 rank 排序）+ unscheduled（无任何日期）。 */
function ganttLayout(tasks, granularity, nowMs): { range: GanttRange; bars: GanttBar[]; unscheduled: BoardTask[] }
```
- 全 UTC（复用 TimelineView 的 UTC 范式）；nowMs 传入可测。

## D. 甘特视图（`src/features/board/GanttView.tsx`，第 4 视图）

- 读 `useBoardStore` tasks + `useBoardViewStore` filter → `visible = tasks.filter(taskMatchesFilter)`；`ganttLayout(visible, granularity, Date.now())`（useMemo）。
- granularity 本地 state（默认 "week"）+ 天/周/月切换。
- 渲染：
  - 顶部时间刻度轴（按 granularity 分列，label 日期）。
  - 每任务一行：左侧任务标题（点击开 TaskSheet），右侧轴区一条 `leftPct/widthPct` 定位的横条（色可用 priority/状态色）。
  - 底部/侧「未排期」区列 unscheduled 任务（可拖上轴赋 due）。
  - 空态（无任务）。
- **拖拽（自定义 pointer，非 dnd-kit）**：
  - 拖条主体：pointermove 累计 dx → `dateAtPixel` 求新 barStart。**保留字段的"设没设"语义**：start+due 都有 → 平移两者保持工期差（`updateTask({start_date,due_date})`）；仅 due（无 start）→ 只移 due，start 仍空（`updateTask({due_date})`）；仅 start → 只移 start。即"移动只挪已设的端点"。
  - 拖左缘手柄：改 start（`updateTask({ start_date })`，不越过 due）。
  - 拖右缘手柄：改 due（`updateTask({ due_date })`，不早于 start）。
  - 从未排期拖入轴：赋 due（或 start+due=落点当天）。
  - 落库失败重抛 → `.catch(toast.error(t("gantt.dragError",{msg})))`。
  - 日期写回用 `fmtUtcDate` "YYYY-MM-DD"（与 due 存储一致）。

## E. 接入

- BoardSurface：VIEWS 加 `{key:"gantt", label:t("view.gantt")}`；分发四态 `kanban/list/timeline/gantt`。
- 保存视图：view_type select 已含 gantt（A1），无需前端额外改（applyConfig 直灌 viewType="gantt"）。
- i18n（board ns，zh+en）：`view.gantt`、`gantt.unscheduled/day/week/month/empty/dragError`、`sheet.fieldStartDate`。

## F. 明确不做（YAGNI / 边界）

- 依赖关系（depends_on/箭头/防环）、里程碑（菱形）——本轮否掉。
- 甘特行不按 state 分组（扁平排序）。
- start>due 不硬校验（resize 缘不越对缘即可）。
- 不改桶式 TimelineView。
- 不做资源/负载泳道、不做关键路径。
- 不做条内进度%（无 progress 字段）。

## G. 约束（继承全局）

- 中文注释；不硬编码（granularity/视图键/padding 用具名常量）。
- store 写失败重抛+toast（拖拽落库）。
- 日期全 UTC、ms 比较不字典序（[[rework-work-report-generator]]）。
- 迁移沿用 date 字段 + select 改值幂等范式；board_tasks 加字段不涉软删。
- TDD：`gantt-layout` 纯函数（pixel↔date 往返、barGeometry、ganttLayout 未排期）先写失败测试。
- Rust 侧零改动。tsc 通过；vitest 过。提交不加 `Co-Authored-By: Claude` 尾注。
- 只 git add 各 Task 确切文件，严禁 -A（工作区有未跟踪 spec/plan + 私有 docs/promotion/）。

## H. 测试

- 纯函数 `gantt-layout`：`pixelForDate`/`dateAtPixel` 往返一致；`barGeometry`（start+due / 仅 due / 仅 start / 皆无=null）；`ganttLayout`（bars 排序 + unscheduled 分离 + range 覆盖）；granularity 对齐。
- 手验（GUI，重启触发迁移）：TaskSheet 可设开始日期；甘特视图第 4 段可切；条按 start→due 定位、仅 due 显最小格、未排期区列出；拖条平移改双期、拖左右缘改单期、落库；天/周/月切换；保存视图存 gantt 并还原；filter 生效。

## 文件影响

- 新 `src-tauri/pb_migrations/1786700000_gantt.js`（start_date + view_type 加 gantt）。
- `src/types/board.ts`（BoardTask.start_date）。
- `src/store/board-view.ts`（BoardView 加 gantt + initialViewType）。
- `src/features/board/TaskSheet.tsx`（start DatePicker + 保存）。
- 新 `src/features/board/gantt-layout.ts` + `gantt-layout.test.ts`。
- 新 `src/features/board/GanttView.tsx`。
- `src/features/board/BoardSurface.tsx`（VIEWS 加甘特 + 四态分发）。
- `src/i18n/locales/{zh,en}/board.json`（view.gantt/gantt.*/sheet.fieldStartDate）。

## 分期（单一 plan）

任务顺序建议：
1. 迁移 `1786700000_gantt.js`（start_date + view_type 加 gantt）+ `BoardTask.start_date` 类型 + `BoardView` 加 gantt/initialViewType。
2. TaskSheet 加开始日期 DatePicker + 保存（含 i18n `sheet.fieldStartDate`）。
3. `gantt-layout.ts` 纯函数（TDD：pixel↔date/barGeometry/ganttLayout）。
4. `GanttView.tsx` 渲染（轴 + 行 + 条 + 未排期，只读，无拖拽）+ BoardSurface 加甘特视图 + i18n `view.gantt`/`gantt.*`。
5. 甘特拖拽（条平移 + 左右缘 resize + 未排期拖入 → updateTask）+ 手验清单。
