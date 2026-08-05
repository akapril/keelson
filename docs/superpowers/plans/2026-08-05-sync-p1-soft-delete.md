# 同步引擎 P1 · 软删除地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给同步集合加 `deleted_at` tombstone，把硬删除全改为软删除、读取全过滤软删记录，为多机同步的删除传播打地基（对用户行为不变：删除仍"消失"，只是软删）。

**Architecture:** 每个同步集合加 `deleted_at`(date) 字段；删除=写 `deleted_at` 而非 `.delete()`；所有 list/get 注入 `deleted_at = ""` 过滤；实时订阅把"update 且 deleted_at 非空"当删除。软删 breaks PB `cascadeDelete`，故 `deleteProject` 改应用层手动级联软删子记录。

**Tech Stack:** PocketBase JS 迁移(`new Field`/`app.save`)、前端 `pocketbase` JS SDK（`src/lib/pb/*.ts` 收口）、Zustand store、Rust `PbClient`(`src-tauri/src/mcp/tools.rs`)、Vitest（前端纯函数）、cargo（Rust）。

## Global Constraints

- 内部代号 `rework` 冻结，不露 web UI；产品名 Keelson。
- **同步集合（本 P1 加 tombstone 的全集）**：`board_projects`, `board_project_states`, `board_project_labels`, `board_project_members`, `board_tasks`, `board_templates`, `doc_assets`, `docs`, `reading_items`, `calendar_events`, `memories`, `prompts`。
- **明确不动**（非同步集合，保持硬删）：`notifications`, `activities`, `sessions_meta/session_tags/session_notes`。
- tombstone 字段名固定 `deleted_at`，类型 `date`，可空；**空值语义 = 未删**。PB date 空值序列化为 `""`，故"未删"过滤统一用 `deleted_at = ""`（集中为常量 `NOT_DELETED`，便于运行时校正）。
- `deleted_at` 与既有 `archived`(项目/任务)、`status`(阅读/记忆) **正交共存**，不复用、不混淆。
- 所有新增注释用中文；store 写失败必须**重抛 + 由调用方 toast**（沿用现状，勿吞错）。
- 不硬编码颜色；不新增依赖。
- Rust 改动需 cargo 验证；实现 Rust 任务前**必须先停 `pnpm tauri dev`**（否则抢 target 目录，见 `rework-git-build-gotchas`）。Windows 本地 `cargo test --lib` 受 Tauri GUI DLL 限制报 0xc0000139，Rust 单测靠 CI(ubuntu)（见 `rework-windows-cargo-test-lib`）。
- 前端每步跑 `pnpm exec tsc --noEmit` + `pnpm exec eslint <改动文件>` + 相关 `pnpm exec vitest run`。
- 频繁提交：每 Task 结束提交一次，中文 conventional commit + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

## 文件结构（改动地图）

- **新建** `src-tauri/pb_migrations/1784097200_tombstones.js` — 给 12 个同步集合加 `deleted_at`。
- **改** `src/lib/pb/collections.ts` — 加 `NOT_DELETED` 常量、`combineFilters()`、`nowIso()`、`softDeleteRecord()`；`deleteRecord` 改软删。
- **新建** `src/lib/pb/collections.test.ts` — `combineFilters`/`nowIso` 纯函数单测。
- **改** `src/lib/pb/{reading,calendar,memory,prompts,docs}.ts` — 各自 `deleteXxxRecord` 改软删 + 各 list/get 注入过滤。
- **改** `src/lib/pb/board.ts` — 9 处 list 注入过滤。
- **改** `src/store/board.ts` — `deleteProject` 级联软删；订阅 handler(onTask/onState/onLabel) 把 tombstone 当删除。
- **改** `src/store/{docs,reading,calendar}.ts` — 订阅 handler 把 tombstone 当删除。
- **新建** `src/lib/pb/tombstone.ts` + `src/lib/pb/tombstone.test.ts` — `isTombstoned(rec)` 纯谓词 + 单测（供订阅 handler 复用）。
- **改** `src-tauri/src/mcp/tools.rs` — 6 处查询注入 `deleted_at = ""`。

---

### Task 1: 迁移 — 给同步集合加 `deleted_at`

**Files:**
- Create: `src-tauri/pb_migrations/1784097200_tombstones.js`

**Interfaces:**
- Produces: 12 个同步集合各新增 `deleted_at`(date, 可空) 字段。字段类型 `date`，空 = 未删。

- [ ] **Step 1: 写迁移文件**（照 `1720001500_task_archived.js` 的 `new Field`/`app.save` 风格；幂等：已存在则跳过）

```javascript
// 多机同步 P1：给同步集合加 deleted_at(date) tombstone 字段。
// 空值=未删；有值(ISO 时间)=已软删。与业务字段 archived/status 正交共存。
// 只覆盖参与同步的集合；notifications/activities/sessions_* 不加。
migrate((app) => {
  const COLLS = [
    "board_projects",
    "board_project_states",
    "board_project_labels",
    "board_project_members",
    "board_tasks",
    "board_templates",
    "doc_assets",
    "docs",
    "reading_items",
    "calendar_events",
    "memories",
    "prompts",
  ];
  for (const name of COLLS) {
    const c = app.findCollectionByNameOrId(name);
    if (!c.fields.getByName("deleted_at")) {
      c.fields.add(new Field({ name: "deleted_at", type: "date", required: false }));
      app.save(c);
    }
  }
}, (app) => {
  // 回滚：逐集合移除 deleted_at
  const COLLS = [
    "board_projects", "board_project_states", "board_project_labels",
    "board_project_members", "board_tasks", "board_templates", "doc_assets",
    "docs", "reading_items", "calendar_events", "memories", "prompts",
  ];
  for (const name of COLLS) {
    try {
      const c = app.findCollectionByNameOrId(name);
      const f = c.fields.getByName("deleted_at");
      if (f) { c.fields.removeById(f.id); app.save(c); }
    } catch (_) {}
  }
});
```

- [ ] **Step 2: 应用迁移并核验字段存在**

停 dev 后，迁移随 sidecar 启动自动执行（`spawn_pocketbase` 加载 `pb_migrations`）。核验（PowerShell/bash 皆可，用 curl 打本地 PB admin API 或直接看 `pb_data`）。最简：启动 app，观察终端无迁移报错；再在设置→后端→打开数据目录，或用 PB 管理台看 `board_tasks` 是否有 `deleted_at` 字段。
Expected: 12 个集合均出现 `deleted_at` 字段，无迁移报错。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/pb_migrations/1784097200_tombstones.js
git commit -m "feat(sync): 迁移给 12 个同步集合加 deleted_at tombstone 字段"
```

---

### Task 2: collections.ts — 软删/过滤基础设施 + 纯函数单测

**Files:**
- Modify: `src/lib/pb/collections.ts`
- Create: `src/lib/pb/collections.test.ts`

**Interfaces:**
- Produces:
  - `NOT_DELETED: string` = `'deleted_at = ""'`（未删过滤片段）
  - `nowIso(): string` — 当前时刻 ISO（写 `deleted_at` 用）
  - `combineFilters(...parts: (string | undefined)[]): string` — 用 `&&` 连接非空片段
  - `softDeleteRecord(coll: string, id: string): Promise<void>` — `update(coll,id,{deleted_at: nowIso()})`
  - `deleteRecord(coll, id)` 语义改为软删（board 通用删除，全部调用方均同步集合）

- [ ] **Step 1: 写 combineFilters / nowIso 的失败测试**

```typescript
// src/lib/pb/collections.test.ts
import { describe, it, expect } from "vitest";
import { combineFilters, NOT_DELETED } from "./collections";

describe("combineFilters", () => {
  it("忽略空片段，用 && 连接", () => {
    expect(combineFilters(NOT_DELETED, 'project = "p1"')).toBe(
      'deleted_at = "" && project = "p1"',
    );
  });
  it("全空返回空串", () => {
    expect(combineFilters(undefined, "", undefined)).toBe("");
  });
  it("单片段原样返回", () => {
    expect(combineFilters(NOT_DELETED)).toBe('deleted_at = ""');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/pb/collections.test.ts`
Expected: FAIL —— `combineFilters` / `NOT_DELETED` 未导出。

- [ ] **Step 3: 在 collections.ts 实现基础设施**（追加到文件末尾；`deleteRecord` 就地改软删）

```typescript
// ── 软删除(tombstone)基础设施 ──────────────────────────────
// 未删过滤：PB date 空值序列化为 ""，故"未删"= deleted_at 为空串。
// 集中为常量，若某 PB 版本对空 date 过滤语义不同，只改此一处。
export const NOT_DELETED = 'deleted_at = ""';

/** 当前时刻 ISO 字符串（写 deleted_at 用）。 */
export const nowIso = (): string => new Date().toISOString();

/** 用 && 连接非空 filter 片段；全空返回空串。 */
export function combineFilters(...parts: (string | undefined)[]): string {
  return parts.filter((p): p is string => !!p && p.length > 0).join(" && ");
}

/** 软删除：写 deleted_at 而非物理删除（同步集合专用）。 */
export function softDeleteRecord(coll: string, id: string): Promise<void> {
  return pb.collection(coll).update(id, { deleted_at: nowIso() }).then(() => undefined);
}
```

就地把 `deleteRecord`（当前第 143-146 行）改为软删（board 的 tasks/states/labels/projects 全是同步集合）：

```typescript
/** 删除记录（软删：写 deleted_at；board 各集合均参与同步）。 */
export function deleteRecord(coll: string, id: string): Promise<void> {
  return softDeleteRecord(coll, id);
}
```

- [ ] **Step 4: 跑测试确认通过 + tsc + eslint**

Run: `pnpm exec vitest run src/lib/pb/collections.test.ts && pnpm exec tsc --noEmit && pnpm exec eslint src/lib/pb/collections.ts src/lib/pb/collections.test.ts`
Expected: PASS；tsc 无错；eslint 无错。

- [ ] **Step 5: 提交**

```bash
git add src/lib/pb/collections.ts src/lib/pb/collections.test.ts
git commit -m "feat(sync): collections 加 NOT_DELETED/combineFilters/softDeleteRecord, deleteRecord 改软删"
```

---

### Task 3: 各域删除函数改软删（reading/calendar/memory/prompts/docs）

**Files:**
- Modify: `src/lib/pb/reading.ts:38-44`, `src/lib/pb/calendar.ts:49-55`, `src/lib/pb/memory.ts:24-26`, `src/lib/pb/prompts.ts:20-22`, `src/lib/pb/docs.ts:58-61`

**Interfaces:**
- Consumes: `softDeleteRecord(coll, id)` from Task 2。
- Produces: `deleteReadingRecord/deleteEventRecord/deleteMemoryRecord/deletePromptRecord/deleteDocRecord` 语义改为软删（签名不变 `(id) => Promise<void>`）。

**说明（重复模式，一次说清）：** 5 个 `deleteXxxRecord` 当前都是 `pb.collection(X).delete(id).then(()=>undefined)`。统一改为调用 `softDeleteRecord(COLL, id)`。签名与调用方不变，仅底层由物理删改软删。

- [ ] **Step 1: reading.ts** — 改 `deleteReadingRecord`

```typescript
// 顶部 import 追加：
import { COL, softDeleteRecord } from "./collections";
// 替换 deleteReadingRecord：
/** 软删除阅读条目（写 deleted_at）。 */
export function deleteReadingRecord(id: string): Promise<void> {
  return softDeleteRecord(COL.readingItems, id);
}
```

- [ ] **Step 2: calendar.ts** — 改 `deleteEventRecord`

```typescript
import { COL, softDeleteRecord } from "./collections";
/** 软删除日历事件（写 deleted_at）。 */
export function deleteEventRecord(id: string): Promise<void> {
  return softDeleteRecord(COL.calendarEvents, id);
}
```

- [ ] **Step 3: memory.ts** — 改 `deleteMemoryRecord`（该文件用局部常量 `COLL = "memories"`，从 collections 引 softDeleteRecord）

```typescript
import { softDeleteRecord } from "./collections";
/** 软删除记忆（写 deleted_at）。 */
export function deleteMemoryRecord(id: string): Promise<void> {
  return softDeleteRecord(COLL, id);
}
```

- [ ] **Step 4: prompts.ts** — 改 `deletePromptRecord`

```typescript
import { softDeleteRecord } from "./collections";
/** 软删除指令（写 deleted_at）。 */
export function deletePromptRecord(id: string): Promise<void> {
  return softDeleteRecord(COLL, id);
}
```

- [ ] **Step 5: docs.ts** — 改 `deleteDocRecord`

```typescript
import { COL, softDeleteRecord } from "./collections";
/** 软删除文档（写 deleted_at）。 */
export function deleteDocRecord(id: string): Promise<void> {
  return softDeleteRecord(COL.docs, id);
}
```

- [ ] **Step 6: tsc + eslint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint src/lib/pb/reading.ts src/lib/pb/calendar.ts src/lib/pb/memory.ts src/lib/pb/prompts.ts src/lib/pb/docs.ts`
Expected: 无错（注意各文件 import 是否已含 `COL`/`softDeleteRecord`，避免重复导入）。

- [ ] **Step 7: 提交**

```bash
git add src/lib/pb/reading.ts src/lib/pb/calendar.ts src/lib/pb/memory.ts src/lib/pb/prompts.ts src/lib/pb/docs.ts
git commit -m "feat(sync): reading/calendar/memory/prompts/docs 删除改软删"
```

---

### Task 4: deleteProject 应用层级联软删

**Files:**
- Modify: `src/store/board.ts:604-637`（`deleteProject`）
- Modify: `src/lib/pb/board.ts`（新增 `listMembers(projectId)`）

**Interfaces:**
- Consumes: `deleteRecord`(已改软删), `listStates/listLabels/listTasks`(Task 5 后带过滤，但删除时拉的是"未删的活跃子记录"，正确), `listAllDocs/deleteDocRecord/updateDocRecord`。
- Produces: `deleteProject(id, opts)` 软删项目时手动软删其 states/labels/members/tasks（因软删不触发 PB cascadeDelete）。
- Produces: `listMembers(projectId): Promise<{id:string}[]>`。

**背景：** 原 `deleteProject` 靠 PB `cascadeDelete` 自动删 states/labels/members、手删 tasks。改软删后 **cascade 不触发** → 必须手动软删所有子记录，否则子记录残留、且会同步到别的机器成孤儿。

- [ ] **Step 1: board.ts 加 `listMembers`**（members 单用户通常为空，但为同步正确性需能软删）

```typescript
// board.ts 顶部 import 追加 BoardMember 若无类型则用最小结构：
/** 获取指定项目的成员记录 id（用于级联软删；单用户常为空）。 */
export function listMembers(projectId: string): Promise<{ id: string }[]> {
  return pb.collection(COL.boardMembers).getFullList<{ id: string }>({
    requestKey: null,
    filter: byProject(projectId),
    fields: "id",
  });
}
```

- [ ] **Step 2: 改 `deleteProject` 级联软删**（`src/store/board.ts`）

```typescript
// 顶部 import 追加 listStates, listLabels, listMembers（若未引入）
deleteProject: async (id, opts) => {
  // 文档多对多不级联：逐个处理关联本项目的文档（逻辑不变）。
  try {
    const docs = await listAllDocs();
    for (const d of docs) {
      if (!d.projects?.includes(id)) continue;
      const others = d.projects.filter((p) => p !== id);
      if (opts?.deleteDocs && others.length === 0) {
        await deleteDocRecord(d.id); // 已改软删
      } else {
        await updateDocRecord(d.id, { projects: others });
      }
    }
  } catch {
    /* 断链/删文档失败不阻断项目删除 */
  }
  // 软删不触发 PB cascadeDelete，故手动软删全部子记录：任务/状态/标签/成员。
  // 拉的是活跃(未删)子记录即可（Task 5 后 listXxx 已过滤软删）。
  const [tasks, states, labels, members] = await Promise.all([
    listTasks(id),
    listStates(id),
    listLabels(id),
    listMembers(id),
  ]);
  await Promise.all([
    ...tasks.map((t) => deleteRecord(COL.boardTasks, t.id)),
    ...states.map((s) => deleteRecord(COL.boardStates, s.id)),
    ...labels.map((l) => deleteRecord(COL.boardLabels, l.id)),
    ...members.map((m) => deleteRecord(COL.boardMembers, m.id)),
  ]);
  // 最后软删项目本身
  await deleteRecord(COL.boardProjects, id);
  set((s) => ({
    projects: s.projects.filter((p) => p.id !== id),
    ...(s.openedProjectId === id
      ? { openedProjectId: null, states: [], labels: [], tasks: [] }
      : {}),
  }));
},
```

- [ ] **Step 3: tsc + eslint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint src/store/board.ts src/lib/pb/board.ts`
Expected: 无错。

- [ ] **Step 4: 提交**

```bash
git add src/store/board.ts src/lib/pb/board.ts
git commit -m "feat(sync): deleteProject 改应用层级联软删(状态/标签/成员/任务)"
```

---

### Task 5: 读取路径注入 NOT_DELETED 过滤

**Files:**
- Modify: `src/lib/pb/board.ts`（9 处 list）、`src/lib/pb/docs.ts`（listDocs/listAllDocs/getDocRecord）、`src/lib/pb/reading.ts`（listReadingItems）、`src/lib/pb/calendar.ts`（listEvents/listEventsByProject）、`src/lib/pb/memory.ts`（listMemories）、`src/lib/pb/prompts.ts`（listPrompts）

**Interfaces:**
- Consumes: `NOT_DELETED`, `combineFilters` from Task 2。
- Produces: 所有同步集合的 list/get 只返回未删记录。

**模式（一次说清）：**
- **无 filter 的 list**：加 `filter: NOT_DELETED`。
- **已有 filter 的 list**：`filter: combineFilters(NOT_DELETED, <原 filter>)`。
- **getOne**（`getDocRecord`）：加 `{ filter: NOT_DELETED }`（PB `getOne` 支持 filter；软删的单篇按未找到处理）。

代表改法（board.ts）：

```typescript
import { COL, combineFilters, NOT_DELETED } from "./collections";

// 无 filter → 加 NOT_DELETED（listTemplates/listProjects/listAllTasks/listAllStates/listDueTasks 同理）
export function listProjects(): Promise<BoardProject[]> {
  return pb.collection(COL.boardProjects).getFullList<BoardProject>({
    requestKey: null,
    filter: NOT_DELETED,
  });
}

// 已有 byProject filter → combineFilters（listStates/listLabels/listTasks 同理）
export function listStates(projectId: string): Promise<BoardState[]> {
  return pb.collection(COL.boardStates).getFullList<BoardState>({
    requestKey: null,
    filter: combineFilters(NOT_DELETED, byProject(projectId)),
    sort: "sort_order",
  });
}

// pb.filter 动态 filter（listTasksBySession）→ combineFilters 包一层
export function listTasksBySession(sessionId: string): Promise<BoardTask[]> {
  return pb.collection(COL.boardTasks).getFullList<BoardTask>({
    requestKey: null,
    filter: combineFilters(NOT_DELETED, pb.filter("source_session_id = {:sid}", { sid: sessionId })),
    sort: "-created",
  });
}
```

**逐文件清单（全部要改）：**
- `board.ts`：`listTemplates`(+NOT_DELETED)、`listProjects`(+NOT_DELETED)、`listStates`(combine)、`listLabels`(combine)、`listTasks`(combine)、`listAllTasks`(+NOT_DELETED)、`listAllStates`(+NOT_DELETED)、`listDueTasks`(+NOT_DELETED)、`listTasksBySession`(combine)。
- `docs.ts`：`listDocs`(combine byProject)、`listAllDocs`(+NOT_DELETED)、`getDocRecord`(+`{filter: NOT_DELETED}`)。
- `reading.ts`：`listReadingItems`(+NOT_DELETED)。
- `calendar.ts`：`listEvents`(+NOT_DELETED)、`listEventsByProject`(combine)。
- `memory.ts`：`listMemories`(+NOT_DELETED)。
- `prompts.ts`：`listPrompts`(+NOT_DELETED)。

- [ ] **Step 1: 按上表逐文件注入过滤**（各文件确保 import 了 `NOT_DELETED`/`combineFilters`）
- [ ] **Step 2: tsc + eslint 全部改动文件**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint src/lib/pb/board.ts src/lib/pb/docs.ts src/lib/pb/reading.ts src/lib/pb/calendar.ts src/lib/pb/memory.ts src/lib/pb/prompts.ts`
Expected: 无错。

- [ ] **Step 3: 手动烟测**（dev 运行下）：新建一条阅读/一个任务 → 删除 → 列表不再出现；刷新后仍不出现（软删已过滤）。

- [ ] **Step 4: 提交**

```bash
git add src/lib/pb/board.ts src/lib/pb/docs.ts src/lib/pb/reading.ts src/lib/pb/calendar.ts src/lib/pb/memory.ts src/lib/pb/prompts.ts
git commit -m "feat(sync): 同步集合读取路径注入 NOT_DELETED 过滤"
```

---

### Task 6: 实时订阅把 tombstone 当删除

**Files:**
- Create: `src/lib/pb/tombstone.ts`, `src/lib/pb/tombstone.test.ts`
- Modify: `src/store/board.ts`（订阅 handler onTask/onState/onLabel，第 266-288 行）、`src/store/docs.ts`、`src/store/reading.ts`、`src/store/calendar.ts`（各自 subscribe handler）

**Interfaces:**
- Produces: `isTombstoned(rec: { deleted_at?: string }): boolean` — deleted_at 非空即为已软删。
- 订阅回调判定：`action === "delete" || isTombstoned(rec)` → 从内存移除；否则 upsert。

**背景：** 软删走 PB 的 **update** 事件（不是 delete 事件），record 带非空 `deleted_at`。订阅侧必须把这类 update 视为移除，否则已删记录会因 upsert 复现在 UI。

- [ ] **Step 1: 写 isTombstoned 失败测试**

```typescript
// src/lib/pb/tombstone.test.ts
import { describe, it, expect } from "vitest";
import { isTombstoned } from "./tombstone";

describe("isTombstoned", () => {
  it("deleted_at 非空 → true", () => {
    expect(isTombstoned({ deleted_at: "2026-08-05T00:00:00Z" })).toBe(true);
  });
  it("deleted_at 空串/缺省 → false", () => {
    expect(isTombstoned({ deleted_at: "" })).toBe(false);
    expect(isTombstoned({})).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/pb/tombstone.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 tombstone.ts**

```typescript
// 软删除谓词：deleted_at 非空即已软删。供实时订阅把"带 deleted_at 的 update"当删除。
export function isTombstoned(rec: { deleted_at?: string }): boolean {
  return !!rec.deleted_at && rec.deleted_at.length > 0;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/pb/tombstone.test.ts`
Expected: PASS。

- [ ] **Step 5: 改 store 订阅 handler**（4 个 store，模式一致）

`src/store/board.ts` 订阅回调（onTask/onState/onLabel）——判定加 `|| isTombstoned(rec)`：

```typescript
import { isTombstoned } from "../lib/pb/tombstone";
// ...
onTask: (action, rec) =>
  set((s) => ({
    tasks:
      action === "delete" || isTombstoned(rec)
        ? removeById(s.tasks, rec.id)
        : upsertById(s.tasks, rec),
  })),
// onState / onLabel 同样加 `|| isTombstoned(rec)`
```

`src/store/docs.ts`、`src/store/reading.ts`、`src/store/calendar.ts` 的 subscribe handler 同法：找到 `action === "delete" ? removeById(...) : upsertById(...)`，改为 `action === "delete" || isTombstoned(rec) ? removeById(...) : upsertById(...)`，并 `import { isTombstoned } from "../lib/pb/tombstone"`。

- [ ] **Step 6: tsc + eslint + 全量 vitest**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint src/lib/pb/tombstone.ts src/store/board.ts src/store/docs.ts src/store/reading.ts src/store/calendar.ts && pnpm exec vitest run`
Expected: 无错；测试全绿。

- [ ] **Step 7: 提交**

```bash
git add src/lib/pb/tombstone.ts src/lib/pb/tombstone.test.ts src/store/board.ts src/store/docs.ts src/store/reading.ts src/store/calendar.ts
git commit -m "feat(sync): 实时订阅把带 deleted_at 的 update 当删除处理"
```

---

### Task 7: Rust MCP 查询注入 deleted_at 过滤

> ⚠️ **本 Task 改 Rust，实现前必须先停 `pnpm tauri dev`**（抢 target 会致构建失败）。Windows 本地 `cargo test --lib` 受限，靠 `cargo check` + CI 验证。

**Files:**
- Modify: `src-tauri/src/mcp/tools.rs`（`by_project`/`docs_by_project` 及 6 处查询）

**Interfaces:**
- Consumes: `PbClient.list/list_all`。
- Produces: MCP 的 list_projects/list_states/list_tasks/create_task(排序查询)/list_docs/search_memory 只返回未删记录。

**背景：** MCP 工具经 `PbClient` 读 PB，同样要滤掉软删记录，否则 AI 看到已删任务/文档/记忆。

- [ ] **Step 1: 加常量 + 改 by_project/docs_by_project 带未删条件**

```rust
/// PB date 空值序列化为 ""；"未删"过滤片段。
const NOT_DELETED: &str = "deleted_at = \"\"";

/// PB filter：未删 && project = "<id>"。
fn by_project(project_id: &str) -> String {
    format!("{} && project = \"{}\"", NOT_DELETED, project_id.replace('"', ""))
}

/// docs 多对多：未删 && projects ~ "<id>"。
fn docs_by_project(project_id: &str) -> String {
    format!("{} && projects ~ \"{}\"", NOT_DELETED, project_id.replace('"', ""))
}
```

- [ ] **Step 2: `list_projects` 由 list_all 改带 filter 的 list**（list_all 无 filter 参数）

```rust
async fn list_projects(ctx: &McpCtx) -> Result<Value, String> {
    let items = ctx
        .client
        .list("board_projects", NOT_DELETED, "id,name")
        .await
        .or_else(|e| err(e))?;
    Ok(json!(items))
}
```

- [ ] **Step 3: `create_task` 的现有任务排序查询加未删条件**（第 68 行 filter）

```rust
let filter = format!(
    "{} && project = \"{}\" && state = \"{}\"",
    NOT_DELETED, pid.replace('"', ""), state.replace('"', "")
);
```

- [ ] **Step 4: `search_memory` 的多条件 filter 追加未删**（在其 filter 构造串首部并入 `deleted_at = "" &&`；`list_states`/`list_tasks`/`list_docs` 已经过 Step 1 的 `by_project`/`docs_by_project` 自动带上，无需再改）

在 `search_memory` 组装 filter 处（原含 `superseded_by = ""` 等 AND 条件）追加 `NOT_DELETED`，例如首个条件前插入 `deleted_at = "" && `。

- [ ] **Step 5: cargo check（停 dev 后）**

Run: `cd src-tauri && cargo check`
Expected: 编译通过，无 warning/error。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/mcp/tools.rs
git commit -m "feat(sync): MCP 查询注入 deleted_at 过滤(项目/状态/任务/文档/记忆)"
```

---

## 验证（端到端）

- **迁移**：启动 app 无迁移报错；PB 管理台确认 12 集合均有 `deleted_at`。
- **软删闭环**（前端，dev 运行）：各类型（阅读/任务/文档/日历/记忆/指令）新建 → 删除 → 列表消失 → 刷新仍消失。
- **级联**：新建项目含状态/标签/任务 → 删除项目 → 该项目全部子记录 `deleted_at` 被置值（PB 管理台查 `board_tasks` filter `project="<id>"` 应全部有 deleted_at）；UI 项目消失。
- **实时**：两个窗口开同一项目（或 web + 桌面），一端删任务 → 另一端实时移除（不复现）。
- **MCP**：删一个任务后，MCP `list_tasks` 不再返回它（用 Claude/Codex 连 MCP 验证，或直接打 PB filter）。
- **Rust**：CI(ubuntu) `cargo test` 绿；本地 `cargo check` 通过。
- **回归**：`pnpm exec vitest run` 全绿；`pnpm exec tsc --noEmit` 无错。

## 已知非目标（P1 不做，留给后续 Pn）

- 墓碑 GC（永留，单用户低量）。
- 同步 worker / watermark / LWW（P2）。
- doc_assets 二进制文件同步（P2 末尾）。
- spoke 接入 UI / 移除 BackendSection 直连（P3）。
