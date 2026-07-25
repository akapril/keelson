# 项目收藏 (Project Favorites) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给项目加星收藏，收藏的项目固定在侧栏顶部「收藏」组、可拖拽排序、一键打开（落点复用已有 tab 记忆）。

**Architecture:** `board_projects` 加 `pinned`(bool)+`pin_rank`(number) 两字段；board store 加派生 `selectPinnedProjects` + 乐观写方法 `toggleProjectPin`/`reorderPin`；ProjectCard 加星标+右键入口；`app-sidebar.tsx` 顶部插动态收藏组（dnd-kit 拖拽）。打开走 `?open=<id>` 深链，落点由既有 `resolveInitialTab` 处理，不改。

**Tech Stack:** PocketBase JS 迁移；React 19 + Zustand；`@dnd-kit`（board 已在用）；`board-rank.ts` 的 `nextRank/rankBetween`（浮点 rank，已测）。

## Global Constraints

- 注释/文案用**中文**；修改带中文注释说明意图。
- 中性主题：**不硬编码颜色**，用 Tailwind 语义类（`text-primary`/`text-muted-foreground` 等）。
- store 写操作：乐观更新 → 失败**回滚 + `throw`** → 调用点 `.catch(e => toast.error(...))`（沿用全项目范式）。
- 复用现有：`board-rank.ts`（`nextRank`/`rankBetween`）、`@dnd-kit`、`updateRecord`（`@/lib/pb/board`）、`COL.boardProjects`、`resolveInitialTab`（`project-tab-pref`）。
- 测试范式：**测纯函数**（参考 `src/store/__tests__/board-store.test.ts` 测 `groupTasksByState`），PB 耦合的 store 方法靠 tsc + 手测。
- 前端改动 reload 生效；PB 迁移随 sidecar 启动自动跑，构建前先 `Get-Process pocketbase | Stop-Process`。

## File Structure

- `src-tauri/pb_migrations/1784097100_project_pin.js` — **新建**：给 `board_projects` 加 `pinned`/`pin_rank`。
- `src/types/board.ts` — 改：`BoardProject` 加 `pinned?`/`pin_rank?`。
- `src/store/board.ts` — 改：加 `selectPinnedProjects`（纯函数导出）+ `toggleProjectPin`/`reorderPin`（store 方法）。
- `src/store/__tests__/project-pin.test.ts` — 新建：测 `selectPinnedProjects`。
- `src/features/board/ProjectList.tsx` — 改：`ProjectCard` 加星标按钮 + 右键项。
- `src/components/app-sidebar.tsx` — 改：顶部插动态「收藏」组。
- `src/features/settings/`（无关，不动）。

---

## Task 1: PB schema + BoardProject 类型

**Files:**
- Create: `src-tauri/pb_migrations/1784097100_project_pin.js`
- Modify: `src/types/board.ts`（`BoardProject` 接口，当前 6-15 行）

**Interfaces:**
- Produces: `board_projects.pinned`(bool)、`board_projects.pin_rank`(number)；`BoardProject.pinned?: boolean`、`BoardProject.pin_rank?: number`。

- [ ] **Step 1: 新建迁移（加两字段）**

`src-tauri/pb_migrations/1784097100_project_pin.js`：
```javascript
// 项目收藏：board_projects 加 pinned(是否收藏) + pin_rank(收藏项排序键，浮点，复用 board rank)。
migrate((app) => {
  const c = app.findCollectionByNameOrId("board_projects");
  c.fields.add(new Field({ name: "pinned", type: "bool" }));
  c.fields.add(new Field({ name: "pin_rank", type: "number" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("board_projects");
  const pin = c.fields.getByName("pinned");
  const rank = c.fields.getByName("pin_rank");
  if (pin) c.fields.removeById(pin.id);
  if (rank) c.fields.removeById(rank.id);
  app.save(c);
});
```

- [ ] **Step 2: BoardProject 类型加字段**

`src/types/board.ts`，在 `BoardProject` 接口 `updated: string;` 之前加：
```typescript
  /** 是否收藏（侧栏收藏组展示） */
  pinned?: boolean;
  /** 收藏项排序键（浮点 rank，未收藏时忽略） */
  pin_rank?: number;
```

- [ ] **Step 3: 编译 + 迁移生效验证**

Run: `npx tsc --noEmit`
Expected: `No errors found`。
重启 rework（PB 启动自动跑迁移），到设置页「打开数据目录」或 PB admin 确认 `board_projects` 有 `pinned`/`pin_rank` 两字段。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/pb_migrations/1784097100_project_pin.js src/types/board.ts
git commit -m "feat(board): board_projects 加 pinned/pin_rank 字段 + 类型"
```

---

## Task 2: board store — 派生 + 收藏/排序方法

**Files:**
- Modify: `src/store/board.ts`（加纯函数 `selectPinnedProjects`、helper `maxPinRank`；`BoardStoreState` 接口加两方法；实现体加两方法）
- Create: `src/store/__tests__/project-pin.test.ts`

**Interfaces:**
- Consumes: `BoardProject.pinned/pin_rank`（Task 1）；`nextRank`/`rankBetween`（`./board-rank`，board.ts 已导入）；`updateRecord`（`../lib/pb/board`，已导入）；`COL.boardProjects`（已导入）。
- Produces:
  - `selectPinnedProjects(projects: BoardProject[]): BoardProject[]`（导出纯函数）
  - `toggleProjectPin(id: string): Promise<void>`（store）
  - `reorderPin(id: string, toIndex: number): Promise<void>`（store）

- [ ] **Step 1: 写失败测试（纯函数 selectPinnedProjects）**

`src/store/__tests__/project-pin.test.ts`：
```typescript
import { describe, it, expect } from "vitest";
import { selectPinnedProjects } from "../board";
import type { BoardProject } from "../../types/board";

const p = (id: string, pinned?: boolean, pin_rank?: number): BoardProject =>
  ({
    id,
    owner: "u",
    name: id,
    created: "",
    updated: "",
    pinned,
    pin_rank,
  } as BoardProject);

describe("selectPinnedProjects", () => {
  it("只取 pinned，按 pin_rank 升序", () => {
    const out = selectPinnedProjects([
      p("a", true, 2048),
      p("b", false, 100),
      p("c", true, 1024),
      p("d"),
    ]);
    expect(out.map((x) => x.id)).toEqual(["c", "a"]);
  });

  it("无收藏返回空数组", () => {
    expect(selectPinnedProjects([p("a"), p("b", false)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run 失败**

Run: `pnpm test project-pin`
Expected: FAIL（`selectPinnedProjects` 未导出）。

- [ ] **Step 3: 实现纯函数 + helper（board.ts 顶部，紧邻现有 `groupTasksByState`）**

在 `src/store/board.ts` 加（放在 `groupTasksByState` 附近的导出区）：
```typescript
/** 收藏项目：只取 pinned，按 pin_rank 升序（未收藏/无 rank 视为 0）。纯函数，便于测试。 */
export function selectPinnedProjects(projects: BoardProject[]): BoardProject[] {
  return projects
    .filter((pj) => pj.pinned)
    .sort((a, b) => (a.pin_rank ?? 0) - (b.pin_rank ?? 0));
}

/** 当前收藏项里最大的 pin_rank（无收藏返回 null），用于「加星追加到末尾」。 */
function maxPinRank(projects: BoardProject[]): number | null {
  const ranks = projects
    .filter((pj) => pj.pinned && pj.pin_rank != null)
    .map((pj) => pj.pin_rank as number);
  return ranks.length ? Math.max(...ranks) : null;
}
```

- [ ] **Step 4: Run 通过**

Run: `pnpm test project-pin`
Expected: PASS。

- [ ] **Step 5: store 接口加两方法**

在 `BoardStoreState` 接口里 `updateProject` 声明附近加：
```typescript
  /** 切换项目收藏：收藏→pinned=true 且 pin_rank 追加到末尾；取消→pinned=false。乐观+回滚重抛。 */
  toggleProjectPin: (id: string) => Promise<void>;
  /** 拖拽重排收藏项：按目标位置算 rankBetween，写 pin_rank。乐观+回滚重抛。 */
  reorderPin: (id: string, toIndex: number) => Promise<void>;
```

- [ ] **Step 6: store 实现两方法（紧邻 `updateProject` 实现）**

```typescript
  // ── 切换收藏（乐观 + 回滚重抛） ─────────────────────────
  toggleProjectPin: async (id) => {
    const snapshot = get().projects;
    const proj = snapshot.find((p) => p.id === id);
    if (!proj) return;
    const willPin = !proj.pinned;
    // 收藏→追加到末尾 rank；取消→仅置 pinned=false（pin_rank 保留、忽略）
    const patch = willPin
      ? { pinned: true, pin_rank: nextRank(maxPinRank(snapshot)) }
      : { pinned: false };
    set({
      projects: snapshot.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
    try {
      await updateRecord(COL.boardProjects, id, patch as Record<string, unknown>);
    } catch (e) {
      set({ projects: snapshot, error: String(e) });
      throw e;
    }
  },

  // ── 拖拽重排收藏（乐观 + 回滚重抛） ─────────────────────
  reorderPin: async (id, toIndex) => {
    const snapshot = get().projects;
    // 排除自己后取前后邻居的 pin_rank，算落点 rank
    const others = selectPinnedProjects(snapshot).filter((p) => p.id !== id);
    const before = others[toIndex - 1]?.pin_rank;
    const after = others[toIndex]?.pin_rank;
    const newRank = rankBetween(before ?? undefined, after ?? undefined);
    set({
      projects: snapshot.map((p) => (p.id === id ? { ...p, pin_rank: newRank } : p)),
    });
    try {
      await updateRecord(COL.boardProjects, id, { pin_rank: newRank });
    } catch (e) {
      set({ projects: snapshot, error: String(e) });
      throw e;
    }
  },
```

- [ ] **Step 7: 编译 + 全测**

Run: `npx tsc --noEmit && pnpm test`
Expected: tsc 通过；全部测试 PASS。

- [ ] **Step 8: Commit**

```bash
git add src/store/board.ts src/store/__tests__/project-pin.test.ts
git commit -m "feat(board): store 加 selectPinnedProjects + toggleProjectPin/reorderPin"
```

---

## Task 3: ProjectCard 星标 + 右键项

**Files:**
- Modify: `src/features/board/ProjectList.tsx`（`ProjectCard`：imports、名称行加星标、ContextMenu 加项）

**Interfaces:**
- Consumes: `toggleProjectPin`（Task 2）、`BoardProject.pinned`（Task 1）。

- [ ] **Step 1: 加 imports**

`src/features/board/ProjectList.tsx` 顶部 import 区加：
```typescript
import { HugeiconsIcon } from "@hugeicons/react";
import { StarIcon } from "@hugeicons/core-free-icons";
```
并在 `ProjectCard` 内解构 store 方法（与现有 `openProject`/`updateProject` 并列）：
```typescript
  const toggleProjectPin = useBoardStore((s) => s.toggleProjectPin);
```

- [ ] **Step 2: 名称行加星标按钮**

在 `ProjectCard` 的名称行（当前 `<div className="flex items-center gap-2">` 内，`{project.archived && ...}` 之后）加：
```tsx
        {/* 收藏星标：已收藏常亮(primary)，未收藏淡显、卡片 hover 才出；点击不触发打开 */}
        <button
          type="button"
          aria-label={project.pinned ? "取消收藏" : "收藏"}
          title={project.pinned ? "取消收藏" : "收藏"}
          onClick={(e) => {
            e.stopPropagation();
            void toggleProjectPin(project.id).catch((err) =>
              toast.error(`收藏失败：${String(err)}`),
            );
          }}
          className={[
            "shrink-0 rounded p-0.5 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring",
            project.pinned
              ? "text-primary opacity-100"
              : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground",
          ].join(" ")}
        >
          <HugeiconsIcon icon={StarIcon} size={16} strokeWidth={2} />
        </button>
```
并给卡片根 `<div role="button" ...>` 的 className 追加 `group`（使 `group-hover` 生效）：把该 div 的 `className` 开头 `"flex cursor-pointer ...` 改为 `"group flex cursor-pointer ...`。

- [ ] **Step 3: 右键菜单加收藏项**

在 `ContextMenuContent` 里，`{/* 打开项目 */}` 与「归档」之间（`<ContextMenuSeparator />` 之前）加：
```tsx
        <ContextMenuItem
          onSelect={() =>
            void toggleProjectPin(project.id).catch((e) =>
              toast.error(`收藏失败：${String(e)}`),
            )
          }
        >
          {project.pinned ? "取消收藏" : "收藏"}
        </ContextMenuItem>
```

- [ ] **Step 4: 编译验证 + 手测**

Run: `npx tsc --noEmit && pnpm lint`
Expected: tsc 无错、lint exit 0。
手测：项目卡片 hover 出现空/淡星，点击变亮（已收藏）；再点取消；右键菜单「收藏/取消收藏」文案随状态切换。

- [ ] **Step 5: Commit**

```bash
git add src/features/board/ProjectList.tsx
git commit -m "feat(board): ProjectCard 加收藏星标 + 右键收藏项"
```

---

## Task 4: 侧栏顶部「收藏」组（dnd-kit 拖拽）

**Files:**
- Modify: `src/components/app-sidebar.tsx`（新增收藏组渲染 + 拖拽 + 挂载加载兜底）

**Interfaces:**
- Consumes: `selectPinnedProjects`（Task 2）、`reorderPin`（Task 2）、board store `projects`/`loadProjects`。
- 打开走 `?open=<id>` 深链（`OPEN_RECORD_PARAM = "open"`，board 页 `src/pages/board.tsx:37-43` 已处理）。

- [ ] **Step 1: 加 imports + 数据**

`src/components/app-sidebar.tsx` 顶部加：
```typescript
import { useEffect, useMemo } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { StarIcon } from "@hugeicons/core-free-icons";
import { useBoardStore, selectPinnedProjects } from "@/store/board";
```
在 `AppSidebar()` 组件体开头（`const { pathname } = useLocation();` 之后）加：
```typescript
  const projects = useBoardStore((s) => s.projects);
  const reorderPin = useBoardStore((s) => s.reorderPin);
  const pinned = useMemo(() => selectPinnedProjects(projects), [projects]);

  // 兜底：侧栏在任意页都可见，若项目尚未加载（用户没进过「项目」页）则拉一次，
  // 使收藏组启动即可用。loadProjects 内部先拆旧订阅再订阅（幂等），重复调用安全。
  useEffect(() => {
    if (!useBoardStore.getState().projects.length) {
      void useBoardStore.getState().loadProjects();
    }
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = pinned.findIndex((p) => p.id === active.id);
    const to = pinned.findIndex((p) => p.id === over.id);
    if (from < 0 || to < 0) return;
    void reorderPin(String(active.id), to).catch(() => {
      /* 失败回滚已在 store 内，拖拽不弹 toast 以免打断 */
    });
    void arrayMove(pinned, from, to); // 仅为语义占位；真实顺序由 store pin_rank 驱动
  };
```
> 说明：`loadProjects` 幂等性在 Task 4 Step 5 手测确认（若发现重复订阅，改为仅 `if (!projects.length && !loading)` 并核对 store 的 `unsub` 逻辑）。

- [ ] **Step 2: 加收藏组渲染（在 `<SidebarContent>` 内、`navGroups.map(...)` 之前）**

```tsx
        {/* 收藏组：置顶，空收藏不渲染；dnd-kit 拖拽排序，点击走 ?open 深链 */}
        {pinned.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>收藏</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={pinned.map((p) => p.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {pinned.map((p) => (
                      <FavoriteRow key={p.id} id={p.id} name={p.name} />
                    ))}
                  </SortableContext>
                </DndContext>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
```

- [ ] **Step 3: 加 `FavoriteRow` 组件（同文件，`AppSidebar` 之外）**

```tsx
/** 收藏组单行：可拖拽排序，点击 NavLink 走 /board?open=<id>（board 页据此打开项目）。 */
function FavoriteRow({ id, name }: { id: string; name: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <SidebarMenuItem ref={setNodeRef} style={style}>
      <SidebarMenuButton asChild tooltip={name}>
        <NavLink to={`/board?open=${id}`} {...attributes} {...listeners}>
          <HugeiconsIcon icon={StarIcon} strokeWidth={2} />
          <span className="truncate">{name}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
```
> `SidebarMenuItem` 需支持 `ref`/`style` 透传——若其类型不接受，改为外层包一个 `<div ref={setNodeRef} style={style}>` 再放 `SidebarMenuItem`（Step 5 tsc 若报错则采用此写法）。

- [ ] **Step 4: 编译 + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: tsc 无错、lint exit 0。（若 `SidebarMenuItem` ref 报错，按 Step 3 备注改外层 div。）

- [ ] **Step 5: 手测**

重载后：
1. 无收藏 → 侧栏无「收藏」组（不渲染空组）。
2. 到「项目」页给两三个项目加星 → 侧栏顶部出现「收藏」组，列出它们。
3. 点收藏项 → 跳 `/board` 并打开该项目，落到它上次停留的 tab。
4. 拖动收藏项重排 → 松手后顺序改变并持久（刷新后仍在）。
5. 确认无重复实时订阅报错（loadProjects 幂等）。

- [ ] **Step 6: Commit**

```bash
git add src/components/app-sidebar.tsx
git commit -m "feat(sidebar): 顶部动态「收藏」组，dnd 拖拽排序 + ?open 一键打开项目"
```

---

## Self-Review

**Spec 覆盖**：①迁移 pinned/pin_rank → Task 1 ✅ ②类型 → Task 1 ✅ ③store 派生+toggle+reorder → Task 2 ✅ ④卡片星标+右键 → Task 3 ✅ ⑤侧栏收藏组+dnd+空态+`?open` → Task 4 ✅ ⑥落点复用 resolveInitialTab（不改）→ Task 4 打开流 ✅。不做项（键盘搜/收藏+tab/封顶/会话中枢降级）均未出现。

**占位扫描**：迁移文件名 `1784097100`（> 现有最大 `1784097043`，确定值）；`SidebarMenuItem` ref 透传给了明确的 fallback（外层 div），非 TODO。无 "TBD/待补"。

**类型一致**：`selectPinnedProjects(BoardProject[])`、`toggleProjectPin(id)`、`reorderPin(id, toIndex)`、`pinned`/`pin_rank` 在 Task 1-4 全程一致；`?open=` 与 board.tsx 现有 `OPEN_RECORD_PARAM="open"` 一致；`nextRank`/`rankBetween` 用 board.ts 已导入的版本。

**已知需手测确认的假设**（非阻断，Task 4 Step 5 覆盖）：`loadProjects` 幂等性；`SidebarMenuItem` 是否接受 ref/style。
