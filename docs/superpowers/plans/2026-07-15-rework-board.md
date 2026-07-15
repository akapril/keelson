# rework Board (Phase ②) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a full workavera-style kanban Board (projects/states/labels/tasks, drag-drop) integrated with retalk sessions (two-tier projects, repo_path join, manual session→task with provenance, linked-sessions panel, git status), all frontend↔PocketBase, no AI.

**Architecture:** Board data lives in PocketBase (new collections via a JS migration), written frontend-side via the PB JS SDK (user token → access rules), exactly like the MVP favorites/notes pattern. Drag-drop uses @dnd-kit with a float `rank`. retalk integration joins on `board_projects.repo_path == session.project_path` in the frontend; a new Rust `git_info` command supplies branch/dirty status. Because PB is a vanilla sidecar (no custom Go routes), project creation is frontend-orchestrated (project → states → labels) with compensation on failure.

**Tech Stack:** PocketBase 0.30 JS migrations, React 19 + TS + Zustand + Tailwind4 + PocketBase JS SDK + @dnd-kit/{core,sortable,utilities}; Rust (Tauri command, git via std::process or `git2` — use CLI `git` via std::process to avoid a heavy dep).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-15-rework-board-design.md`. workavera reference (read-only): `D:/workspace/workavera/` (Go/PB — borrow design, don't copy).
- PB field names are **snake_case**; `src/types/board.ts` must mirror them **verbatim** (`repo_path`, `sort_order`, `due_date`, `created_by`, `source_session_id`, `source_provider`, `source_anchor`). This prevents the MVP-class contract bugs.
- Frontend isolation: components never call `invoke` directly (only `src/lib/tauri/ipc.ts`) and never `pb.collection` directly (only `src/lib/pb/collections.ts` / a board data module under `lib/pb/`).
- All colors via CSS var / Tailwind semantic classes — no hardcoded hex/rgba **in framework UI**. (State/label `color` values are user data, rendered via inline `style` — that is allowed.)
- Neutral light+dark theme (NOT Morandi). Rust comments in Chinese.
- Every board collection has `owner`/`project` relation + access rules from spec §2 (single-user now, member-traversal clause present for zero-migration multi-user). `board_project_members` table exists but stays empty.
- Frequent commits: one per task min. Conventional Commits; every commit message ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Environment: cannot drive GUI (`pnpm tauri dev`) — verify via `pnpm exec tsc --noEmit` + `cargo test`/`cargo check` + `pnpm test`, and **spawn the bundled PB against a temp dir + curl** for live-PB write-path checks. **Always kill PB/rework processes after** (`powershell -Command "Get-Process pocketbase*,rework* | Stop-Process -Force"`) or cargo build breaks (held .exe).
- Base branch `master`; work on `feat/board` (already created & checked out).

---

## Task 1: PB migration — board collections + seed templates

**Files:**
- Create: `src-tauri/pb_migrations/1720000100_board.js`

**Interfaces:**
- Produces PB collections: `board_projects`, `board_project_states`, `board_project_labels`, `board_tasks`, `board_project_members`, `board_templates` (+ seeded global templates).
- Consumes: the `users` collection + the JSVM `Collection`/`Field` API already proven working in `src-tauri/pb_migrations/1720000000_init.js` (read it first for the exact 0.30 API shape — `new Collection({...})`, `col.fields.add(new Field({...}))`, `col.addIndex(name, unique, "cols", "")`, `app.save(col)`).

- [ ] **Step 1: Write the migration**

`src-tauri/pb_migrations/1720000100_board.js`:
```js
// rework Board 迁移：项目/状态/标签/任务/成员/模板 + 内置模板 seed。
// 每表 owner|project relation + access rules（成员传递规则保留，多用户零迁移）。
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const rel = (name, collId, required, cascade) => new Field({
    name, type: "relation", required: !!required,
    collectionId: collId, cascadeDelete: !!cascade, maxSelect: 1,
  });
  const relMulti = (name, collId, max) => new Field({
    name, type: "relation", required: false, collectionId: collId,
    cascadeDelete: false, maxSelect: max,
  });
  const text = (name, required, max) => new Field({ name, type: "text", required: !!required, max: max || 0 });
  const sel = (name, values) => new Field({ name, type: "select", required: true, maxSelect: 1, values });
  const num = (name, required) => new Field({ name, type: "number", required: !!required });
  const bool = (name) => new Field({ name, type: "bool" });
  const json = (name, required) => new Field({ name, type: "json", required: !!required, maxSize: 65536 });
  const date = (name) => new Field({ name, type: "date" });

  const projMemberVisible = "board_project_members_via_project.user ?= @request.auth.id";
  const ownerOrMember = `(project.owner = @request.auth.id || project.${projMemberVisible})`;

  // 1) board_projects
  const projects = new Collection({
    name: "board_projects", type: "base",
    listRule:   `@request.auth.id != "" && (owner = @request.auth.id || ${projMemberVisible})`,
    viewRule:   `@request.auth.id != "" && (owner = @request.auth.id || ${projMemberVisible})`,
    createRule: `@request.auth.id != "" && @request.body.owner = @request.auth.id`,
    updateRule: `owner = @request.auth.id && @request.body.owner:changed = false`,
    deleteRule: `owner = @request.auth.id`,
  });
  projects.fields.add(rel("owner", users.id, true, true));
  projects.fields.add(text("name", true, 160));
  projects.fields.add(text("description", false, 2000));
  projects.fields.add(bool("archived"));
  projects.fields.add(text("repo_path", false, 500));
  projects.addIndex("idx_bp_owner_updated", false, "owner, updated", "");
  projects.addIndex("idx_bp_owner_repo", false, "owner, repo_path", "");
  app.save(projects);
  const projId = app.findCollectionByNameOrId("board_projects").id;

  // 2) board_project_members（建表但单用户空）
  const members = new Collection({
    name: "board_project_members", type: "base",
    listRule:   `@request.auth.id != "" && ${ownerOrMember}`,
    viewRule:   `@request.auth.id != "" && ${ownerOrMember}`,
    createRule: `project.owner = @request.auth.id`,
    updateRule: `project.owner = @request.auth.id && @request.body.project:changed = false && @request.body.user:changed = false`,
    deleteRule: `project.owner = @request.auth.id`,
  });
  members.fields.add(rel("project", projId, true, true));
  members.fields.add(rel("user", users.id, true, false));
  members.fields.add(sel("role", ["admin", "member", "viewer"]));
  members.addIndex("idx_bpm_project_user", true, "project, user", "");
  app.save(members);

  // 3) board_project_states
  const childRules = {
    listRule:   `@request.auth.id != "" && ${ownerOrMember}`,
    viewRule:   `@request.auth.id != "" && ${ownerOrMember}`,
    createRule: `project.owner = @request.auth.id`,
    updateRule: `project.owner = @request.auth.id && @request.body.project:changed = false`,
    deleteRule: `project.owner = @request.auth.id`,
  };
  const states = new Collection({ name: "board_project_states", type: "base", ...childRules });
  states.fields.add(rel("project", projId, true, true));
  states.fields.add(text("name", true, 100));
  states.fields.add(text("color", true, 20));
  states.fields.add(sel("category", ["pending", "active", "completed"]));
  states.fields.add(num("sort_order", true));
  states.addIndex("idx_bps_project_name", true, "project, name", "");
  states.addIndex("idx_bps_project_order", false, "project, sort_order", "");
  app.save(states);
  const stateId = app.findCollectionByNameOrId("board_project_states").id;

  // 4) board_project_labels
  const labels = new Collection({ name: "board_project_labels", type: "base", ...childRules });
  labels.fields.add(rel("project", projId, true, true));
  labels.fields.add(text("name", true, 80));
  labels.fields.add(text("color", true, 20));
  labels.addIndex("idx_bpl_project_name", true, "project, name", "");
  app.save(labels);
  const labelId = app.findCollectionByNameOrId("board_project_labels").id;

  // 5) board_tasks
  const tasks = new Collection({
    name: "board_tasks", type: "base",
    listRule:   `@request.auth.id != "" && ${ownerOrMember}`,
    viewRule:   `@request.auth.id != "" && ${ownerOrMember}`,
    createRule: `@request.auth.id != "" && ${ownerOrMember}`,
    updateRule: `${ownerOrMember} && @request.body.project:changed = false && @request.body.created_by:changed = false`,
    deleteRule: `${ownerOrMember}`,
  });
  tasks.fields.add(rel("project", projId, true, true));
  tasks.fields.add(rel("state", stateId, true, false));
  tasks.fields.add(text("title", true, 240));
  tasks.fields.add(text("description", false, 10000));
  tasks.fields.add(sel("priority", ["none", "low", "medium", "high", "urgent"]));
  tasks.fields.add(num("rank", false));
  tasks.fields.add(date("due_date"));
  tasks.fields.add(relMulti("assignees", users.id, 20));
  tasks.fields.add(relMulti("labels", labelId, 20));
  tasks.fields.add(rel("created_by", users.id, true, false));
  tasks.fields.add(text("source_session_id", false, 200));
  tasks.fields.add(text("source_provider", false, 40));
  tasks.fields.add(text("source_anchor", false, 200));
  tasks.addIndex("idx_bt_project_state_rank", false, "project, state, rank", "");
  app.save(tasks);

  // 6) board_templates + seed（内置全局，owner=""）
  const templates = new Collection({
    name: "board_templates", type: "base",
    listRule:   `@request.auth.id != "" && (owner = "" || owner = @request.auth.id)`,
    viewRule:   `@request.auth.id != "" && (owner = "" || owner = @request.auth.id)`,
    createRule: `@request.auth.id != "" && @request.body.owner = @request.auth.id`,
    updateRule: `owner = @request.auth.id && @request.body.owner:changed = false`,
    deleteRule: `owner = @request.auth.id`,
  });
  templates.fields.add(new Field({ name: "owner", type: "relation", required: false, collectionId: users.id, cascadeDelete: false, maxSelect: 1 }));
  templates.fields.add(text("name", true, 120));
  templates.fields.add(text("description", false, 1000));
  templates.fields.add(json("states", true));
  templates.fields.add(json("labels", false));
  templates.addIndex("idx_btpl_owner_name", true, "owner, name", "");
  app.save(templates);

  // 精选双语模板 seed（category: pending/active/completed）
  const seeds = [
    { name: "简易看板", description: "最简三列", states: [
      { name: "待处理", color: "#94a3b8", category: "pending" },
      { name: "进行中", color: "#3b82f6", category: "active" },
      { name: "已完成", color: "#22c55e", category: "completed" }], labels: [] },
    { name: "Simple Kanban", description: "Minimal three columns", states: [
      { name: "Backlog", color: "#94a3b8", category: "pending" },
      { name: "In Progress", color: "#3b82f6", category: "active" },
      { name: "Done", color: "#22c55e", category: "completed" }], labels: [] },
    { name: "软件开发", description: "开发流程", states: [
      { name: "待办", color: "#94a3b8", category: "pending" },
      { name: "进行中", color: "#3b82f6", category: "active" },
      { name: "测试中", color: "#a855f7", category: "active" },
      { name: "已完成", color: "#22c55e", category: "completed" }],
      labels: [ { name: "bug", color: "#ef4444" }, { name: "feature", color: "#3b82f6" }, { name: "重构", color: "#f59e0b" } ] },
    { name: "问题跟踪", description: "缺陷流转", states: [
      { name: "已报告", color: "#94a3b8", category: "pending" },
      { name: "处理中", color: "#3b82f6", category: "active" },
      { name: "验证中", color: "#a855f7", category: "active" },
      { name: "已解决", color: "#22c55e", category: "completed" }],
      labels: [ { name: "紧急", color: "#ef4444" }, { name: "回归", color: "#f59e0b" } ] },
  ];
  for (const s of seeds) {
    const rec = new Record(templates);
    rec.set("owner", "");
    rec.set("name", s.name);
    rec.set("description", s.description);
    rec.set("states", s.states);
    rec.set("labels", s.labels);
    app.save(rec);
  }
}, (app) => {
  for (const n of ["board_tasks", "board_project_labels", "board_project_states", "board_project_members", "board_templates", "board_projects"]) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  }
});
```
> Verify the `new Record(collection)` + `rec.set(...)` seed API against PB 0.30 JSVM (init migration used `new Field`/`new Collection`; the Record API may differ — if `new Record` is unavailable in JSVM, seed via `app.save(new Record(...))` alternative or a `$app` helper; confirm empirically in Step 2). Also confirm `maxSize` on json fields and `values` on select fields match the 0.30 field API.

- [ ] **Step 2: Empirically verify the migration against the real PB binary**

Run (bash), then KILL PB:
```bash
PB=$(ls src-tauri/binaries/pocketbase-*.exe | head -1)
rm -rf /tmp/pbboard && "$PB" serve --http 127.0.0.1:18799 --dir /tmp/pbboard --migrationsDir "$(pwd)/src-tauri/pb_migrations" &
sleep 4
"$PB" superuser upsert admin@x.io Passw0rd123! --dir /tmp/pbboard
# get admin token
TOK=$(curl -s -X POST http://127.0.0.1:18799/api/collections/_superusers/auth-with-password -H 'Content-Type: application/json' -d '{"identity":"admin@x.io","password":"Passw0rd123!"}' | python -c "import sys,json;print(json.load(sys.stdin)['token'])")
echo "--- collections ---"; curl -s http://127.0.0.1:18799/api/collections -H "Authorization: $TOK" | python -c "import sys,json;print([c['name'] for c in json.load(sys.stdin)['items']])"
echo "--- templates seeded ---"; curl -s "http://127.0.0.1:18799/api/collections/board_templates/records" -H "Authorization: $TOK" | python -c "import sys,json;d=json.load(sys.stdin);print(d.get('totalItems'), [i['name'] for i in d.get('items',[])])"
powershell -Command "Get-Process pocketbase* | Stop-Process -Force"
```
Expected: the 6 board_* collections present; `board_templates` totalItems == 4 with the seeded names. If the migration errors (check PB stdout), fix the JSVM API calls and re-run. **Confirm PB killed.**

- [ ] **Step 3: Commit**
```bash
git add src-tauri/pb_migrations/1720000100_board.js
git commit -m "feat(board): PB migration for board collections + seeded templates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: TS types + collections helper

**Files:**
- Create: `src/types/board.ts`
- Modify: `src/lib/pb/collections.ts` (add `COL` entries)

**Interfaces:**
- Produces: `BoardProject`, `BoardState`, `BoardLabel`, `BoardTask`, `BoardTemplate`, `BoardMember` TS interfaces mirroring the PB fields verbatim; `COL.boardProjects/boardStates/boardLabels/boardTasks/boardMembers/boardTemplates` constants.
- Consumes: `src/lib/pb/collections.ts` (`list`/`create`/`update` from MVP Task 6).

- [ ] **Step 1: Write types** — `src/types/board.ts`:
```ts
// 字段逐字对齐 PB 迁移(1720000100_board.js)的 snake_case 字段名。
export type StateCategory = "pending" | "active" | "completed";
export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";
export type MemberRole = "admin" | "member" | "viewer";

export interface BoardProject {
  id: string; owner: string; name: string; description?: string;
  archived?: boolean; repo_path?: string; created: string; updated: string;
}
export interface BoardState {
  id: string; project: string; name: string; color: string;
  category: StateCategory; sort_order: number; created: string; updated: string;
}
export interface BoardLabel {
  id: string; project: string; name: string; color: string; created: string; updated: string;
}
export interface BoardTask {
  id: string; project: string; state: string; title: string; description?: string;
  priority: TaskPriority; rank?: number; due_date?: string;
  assignees?: string[]; labels?: string[]; created_by: string;
  source_session_id?: string; source_provider?: string; source_anchor?: string;
  created: string; updated: string;
}
export interface BoardMember { id: string; project: string; user: string; role: MemberRole; }
export interface TemplateStateDef { name: string; color: string; category: StateCategory; }
export interface TemplateLabelDef { name: string; color: string; }
export interface BoardTemplate {
  id: string; owner: string; name: string; description?: string;
  states: TemplateStateDef[]; labels?: TemplateLabelDef[]; created: string; updated: string;
}
```
- [ ] **Step 2: Extend `COL`** in `src/lib/pb/collections.ts`:
```ts
export const COL = {
  sessionsMeta: "sessions_meta",
  sessionTags: "session_tags",
  sessionNotes: "session_notes",
  boardProjects: "board_projects",
  boardStates: "board_project_states",
  boardLabels: "board_project_labels",
  boardTasks: "board_tasks",
  boardMembers: "board_project_members",
  boardTemplates: "board_templates",
} as const;
```
- [ ] **Step 3: Verify** `pnpm exec tsc --noEmit` → clean.
- [ ] **Step 4: Commit** `feat(board): TS types + collection constants`.

---

## Task 3: Rust `git_info` command (TDD)

**Files:**
- Create: `src-tauri/src/commands/git.rs`
- Modify: `src-tauri/src/commands/mod.rs` (`pub mod git;`), `src-tauri/src/lib.rs` (register in `generate_handler!`)

**Interfaces:**
- Produces: `#[tauri::command] pub fn git_info(path: String) -> GitInfo` where `pub struct GitInfo { pub branch: Option<String>, pub dirty_count: u32, pub is_repo: bool }` (`#[derive(Serialize, Clone, Debug)]`).
- Uses CLI `git` via `std::process::Command` (no new crate). Port the intent from retalk `D:/workspace/retalk-claude/src-tauri/src/commands.rs::get_project_git_info` (read it).

- [ ] **Step 1: Write failing test** — in `git.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parse_status_counts_dirty_lines() {
        // git status --porcelain 每行一个变更；解析计数应匹配行数
        let out = " M src/a.rs\n?? new.txt\nA  b.rs\n";
        assert_eq!(count_dirty(out), 3);
        assert_eq!(count_dirty(""), 0);
    }
    #[test]
    fn parse_branch_from_head() {
        assert_eq!(parse_branch("refs/heads/feat/board\n"), Some("feat/board".to_string()));
        assert_eq!(parse_branch("HEAD\n"), None); // detached
    }
}
```
- [ ] **Step 2: Run** `cd src-tauri && cargo test commands::git` → FAIL (fns missing).
- [ ] **Step 3: Implement** `git.rs`:
```rust
//! git_info 命令：读取本地仓库的当前分支与未提交变更数（移植自 retalk）。
use serde::Serialize;
use std::process::Command;

#[derive(Serialize, Clone, Debug)]
pub struct GitInfo { pub branch: Option<String>, pub dirty_count: u32, pub is_repo: bool }

/// 统计 `git status --porcelain` 输出的变更行数。
pub fn count_dirty(porcelain: &str) -> u32 {
    porcelain.lines().filter(|l| !l.trim().is_empty()).count() as u32
}
/// 从 `git symbolic-ref HEAD` 输出解析分支名；detached(HEAD) 返回 None。
pub fn parse_branch(symref: &str) -> Option<String> {
    let s = symref.trim();
    s.strip_prefix("refs/heads/").map(|b| b.to_string())
}

fn git(path: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("git").arg("-C").arg(path).args(args).output().ok()?;
    if !out.status.success() { return None; }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
pub fn git_info(path: String) -> GitInfo {
    // 探测是否是 git 仓库
    let is_repo = git(&path, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true").unwrap_or(false);
    if !is_repo { return GitInfo { branch: None, dirty_count: 0, is_repo: false }; }
    let branch = git(&path, &["symbolic-ref", "HEAD"]).and_then(|s| parse_branch(&s));
    let dirty_count = git(&path, &["status", "--porcelain"]).map(|s| count_dirty(&s)).unwrap_or(0);
    GitInfo { branch, dirty_count, is_repo: true }
}
```
- [ ] **Step 4:** Add `pub mod git;` to `commands/mod.rs`; add `commands::git::git_info` to the `generate_handler![...]` list in `lib.rs`.
- [ ] **Step 5: Run** `cargo test commands::git` → PASS; `cargo check` clean.
- [ ] **Step 6: Commit** `feat(board): git_info Tauri command + tests`.

---

## Task 4: Rank math helpers (pure TS, TDD)

**Files:**
- Create: `src/store/board-rank.ts`, `src/store/__tests__/board-rank.test.ts`

**Interfaces:**
- Produces:
  - `nextRank(maxRank: number | null): number` — `maxRank == null ? 1024 : maxRank + 1024`.
  - `rankBetween(before?: number, after?: number): number` — both → `(before+after)/2`; only before → `before+1024`; only after → `after-1024`; neither → `1024`.
  - `normalizeSortOrders(count: number): number[]` — `[1024, 2048, ...]` (`(i+1)*1024`).

- [ ] **Step 1: Failing test** — `board-rank.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { nextRank, rankBetween, normalizeSortOrders } from "../board-rank";
describe("rank", () => {
  it("nextRank", () => { expect(nextRank(null)).toBe(1024); expect(nextRank(1024)).toBe(2048); });
  it("rankBetween", () => {
    expect(rankBetween(1024, 2048)).toBe(1536);
    expect(rankBetween(1024, undefined)).toBe(2048);
    expect(rankBetween(undefined, 2048)).toBe(1024);
    expect(rankBetween(undefined, undefined)).toBe(1024);
  });
  it("normalizeSortOrders", () => { expect(normalizeSortOrders(3)).toEqual([1024, 2048, 3072]); });
});
```
- [ ] **Step 2: Run** `pnpm test board-rank` → FAIL.
- [ ] **Step 3: Implement** `board-rank.ts`:
```ts
// 拖拽排序的浮点 rank 计算（lexorank 数值变体），纯函数便于测试。
export function nextRank(maxRank: number | null): number {
  return maxRank == null ? 1024 : maxRank + 1024;
}
export function rankBetween(before?: number, after?: number): number {
  if (before != null && after != null) return (before + after) / 2;
  if (before != null) return before + 1024;
  if (after != null) return after - 1024;
  return 1024;
}
export function normalizeSortOrders(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * 1024);
}
```
- [ ] **Step 4: Run** `pnpm test board-rank` → PASS.
- [ ] **Step 5: Commit** `feat(board): rank math helpers + tests`.

---

## Task 5: Board data module + `useBoardStore` (load + CRUD, no drag yet)

**Files:**
- Create: `src/lib/pb/board.ts` (PB SDK data access for board), `src/store/board.ts`
- Test: `src/store/__tests__/board-store.test.ts` (a pure helper)

**Interfaces:**
- Produces `src/lib/pb/board.ts` — thin PB SDK wrappers (the ONLY board place touching `pb.collection`):
  - `listTemplates(): Promise<BoardTemplate[]>`, `listProjects(): Promise<BoardProject[]>`
  - `listStates(projectId): Promise<BoardState[]>` (sort by `sort_order`), `listLabels(projectId)`, `listTasks(projectId): Promise<BoardTask[]>` (sort by `rank`)
  - `createRecord<T>(coll, data): Promise<T>`, `updateRecord<T>(coll, id, data): Promise<T>`, `deleteRecord(coll, id): Promise<void>`
- Produces `useBoardStore` (Zustand): `{ templates, projects, openedProjectId, states, labels, tasks, loading, error, loadTemplates(), loadProjects(), openProject(id), createTask(input), updateTask(id, patch), tasksByState(): Record<string, BoardTask[]> }`. (Project/state/label creation handled in Task 7; drag in Task 8.)
- Produces a pure helper `groupTasksByState(tasks: BoardTask[]): Record<string, BoardTask[]>` (exported from `board.ts`) — tested.
- Consumes: `src/lib/pb/board.ts`, `src/types/board.ts`, `currentUserId` from `src/lib/pb`.

- [ ] **Step 1:** Write `src/lib/pb/board.ts` using `pb.collection(COL.x).getFullList/create/update/delete` (mirror MVP `collections.ts` patterns; sort via `{ sort: "sort_order" }` / `{ sort: "rank" }`, `requestKey: null`).
- [ ] **Step 2: Failing test** — `board-store.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { groupTasksByState } from "../board";
import type { BoardTask } from "../../types/board";
const t = (id: string, state: string): BoardTask => ({ id, state, project:"p", title:id, priority:"none", created_by:"u", created:"", updated:"" } as BoardTask);
describe("groupTasksByState", () => {
  it("groups by state id", () => {
    const g = groupTasksByState([t("a","s1"), t("b","s2"), t("c","s1")]);
    expect(g["s1"].map(x=>x.id)).toEqual(["a","c"]);
    expect(g["s2"].map(x=>x.id)).toEqual(["b"]);
  });
});
```
- [ ] **Step 3: Run** `pnpm test board-store` → FAIL.
- [ ] **Step 4: Implement** `groupTasksByState` in `src/store/board.ts` + the store shape (actions call `lib/pb/board.ts`; `createTask` sets `created_by: currentUserId()`, `rank: nextRank(maxRankInState)`, `owner` is implicit via project). Export `groupTasksByState`.
- [ ] **Step 5: Run** `pnpm test board-store` + `pnpm exec tsc --noEmit` → PASS/clean.
- [ ] **Step 6: Commit** `feat(board): board data module + useBoardStore (load + task CRUD)`.

---

## Task 6: Board page + sidebar nav + route + project list

**Files:**
- Create: `src/pages/board.tsx`, `src/features/board/ProjectList.tsx`
- Modify: `src/router.tsx` (add `/board`), `src/components/layout/AppSidebar.tsx` (add nav item)

**Interfaces:**
- `board.tsx` loads projects+templates on mount (`useBoardStore`); renders `ProjectList` (project cards) + a "新建项目" button (opens Task 7's dialog — stub the button now, wire in Task 7). Sidebar gains "看板" → `/board`.

- [ ] **Step 1:** Add nav item `{ to: "/board", label: "看板" }` to `AppSidebar.tsx` items array; add `<Route path="/board" element={<Board/>}/>` to `router.tsx` (import default from `./pages/board`).
- [ ] **Step 2:** `board.tsx`: `useEffect(() => { useBoardStore.getState().loadTemplates(); useBoardStore.getState().loadProjects(); }, [])`; render `ProjectList` (map projects → card showing name, archived badge, repo_path if set). Semantic Tailwind only.
- [ ] **Step 3: Verify** `pnpm exec tsc --noEmit` clean + `pnpm test` still green.
- [ ] **Step 4: Commit** `feat(board): board page + sidebar nav + project list`.

---

## Task 7: Create project (frontend orchestration + compensation) + live-PB verify

**Files:**
- Create: `src/features/board/CreateProjectDialog.tsx`, `src/features/board/create-project.ts`
- Modify: `src/store/board.ts` (add `createProjectFromTemplate`)

**Interfaces:**
- Produces `createProjectFromTemplate(input: { name, description?, repo_path?, template: BoardTemplate }): Promise<BoardProject>` in `create-project.ts` — orchestrates: (1) create `board_projects` (owner=currentUserId); (2) for each `template.states[i]` create `board_project_states` with `sort_order = (i+1)*1024`; (3) for each `template.labels` create `board_project_labels`; **on any failure after step 1, delete the created project (cascade removes children) and rethrow.**
- `CreateProjectDialog` collects name/description/optional repo_path + template picker → calls it → refreshes store.

- [ ] **Step 1:** Implement `create-project.ts` per the interface (use `createRecord`/`deleteRecord` from `lib/pb/board.ts`; `normalizeSortOrders` for state order).
- [ ] **Step 2:** Implement `CreateProjectDialog.tsx` (semantic-class modal or shadcn dialog if present; template `<select>`; optional repo_path input). Wire the "新建项目" button from Task 6.
- [ ] **Step 3: Live-PB verify** the orchestration end-to-end (the write path that CI can't cover). Spawn PB against a temp dir + migrations, create superuser + a users record + user token; then via curl reproduce the orchestration: POST board_projects (owner=userId) → POST 3 board_project_states (project=projId, sort_order 1024/2048/3072, category enum) → GET states filtered by project → confirm 3 rows created and access rules accept them. **KILL PB after.** Capture commands+responses in the report. If a rule/field rejects (e.g. category enum value, owner relation), fix and re-run.
- [ ] **Step 4: Verify** `pnpm exec tsc --noEmit` + `pnpm test` green; `cargo check` clean (after PB killed).
- [ ] **Step 5: Commit** `feat(board): create project via frontend orchestration + compensation`.

---

## Task 8: Kanban board with drag-drop (@dnd-kit)

**Files:**
- Create: `src/features/board/KanbanBoard.tsx`, `StatusColumn.tsx`, `TaskCard.tsx`
- Modify: `src/store/board.ts` (add `moveTask`), `package.json` (add dnd-kit)

**Interfaces:**
- Add deps: `pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`.
- Produces `moveTask(taskId, toStateId, toIndex): Promise<void>` in the store: compute `rank = rankBetween(before?.rank, after?.rank)` from the target column's ordered tasks (excluding the dragged), **optimistic update** (set task state+rank in store), then `updateRecord(COL.boardTasks, taskId, { state: toStateId, rank })`; on error **roll back** to the previous task snapshot.
- `KanbanBoard` (opened project): `DndContext` (PointerSensor distance 6) + `DragOverlay`; renders one `StatusColumn` per state (ordered by `sort_order`); each column = `useDroppable(id="state:<stateId>")` + `SortableContext` of `TaskCard`s (`useSortable(id=task.id)`), tasks from `tasksByState()`. `onDragEnd`: resolve target state + index → `moveTask`.

**Reference (dnd-kit usage):** workavera `D:/workspace/workavera/frontend/src/components/board/{kanban-board,status-column,todo-card}.tsx` (droppable id `state:<id>`, sortable data `{type,projectId,stateId}`, cross-column index resolution). Borrow the patterns; our data types are `BoardState`/`BoardTask`.

- [ ] **Step 1:** Add dnd-kit deps.
- [ ] **Step 2:** Implement `moveTask` in the store (rank calc via `rankBetween`, optimistic + rollback). No unit test (would need PB); the rank math is already tested in Task 4.
- [ ] **Step 3:** Implement `TaskCard` (semantic classes; show title, priority dot, label chips via inline `style={{background: label.color}}`, due_date, and a "来源会话" badge if `source_session_id` — wired in Task 12). `useSortable`.
- [ ] **Step 4:** Implement `StatusColumn` (`useDroppable`, `SortableContext` vertical, header shows state.name with `style` color dot + count).
- [ ] **Step 5:** Implement `KanbanBoard` (`DndContext`, sensors, `onDragEnd` → resolve → `moveTask`, `DragOverlay`). Open a project from `ProjectList` → renders `KanbanBoard`.
- [ ] **Step 6: Verify** `pnpm exec tsc --noEmit` + `pnpm test` green. (Drag behavior is DEFERRED-MANUAL.)
- [ ] **Step 7: Commit** `feat(board): kanban board with dnd-kit drag-drop + rank`.

---

## Task 9: TaskSheet (create/edit task)

**Files:** Create `src/features/board/TaskSheet.tsx`; modify `KanbanBoard`/`TaskCard` to open it.

**Interfaces:** consumes `useBoardStore` (`createTask`/`updateTask`, `states`, `labels`). Fields: title, description, state (select), priority (select 5 values), labels (multi-toggle), due_date (date input). Create mode: "add task" per column; Edit mode: click a card.

- [ ] **Step 1:** Implement `TaskSheet` (semantic modal; controlled inputs; on save → `createTask`/`updateTask` → close). Priority options `none/low/medium/high/urgent`; state options from store; label multi-select from project labels.
- [ ] **Step 2:** Wire "+ 任务" per column (create, prefills state) + card click (edit).
- [ ] **Step 3: Verify** tsc + test green.
- [ ] **Step 4: Commit** `feat(board): task create/edit sheet`.

---

## Task 10: ProjectSheet (states/labels/repo_path/archive)

**Files:** Create `src/features/board/ProjectSheet.tsx`; modify `board.ts` store (state/label CRUD + `updateProject`).

**Interfaces:** store adds `createState/updateState/deleteState` (deleteState **guarded**: refuse if any task references it — check `tasks.some(t=>t.state===id)` → throw/toast), `createLabel/updateLabel/deleteLabel`, `updateProject(id, {name?,description?,repo_path?,archived?})`. `ProjectSheet` manages the opened project's states (name/color/category/reorder via `normalizeSortOrders`), labels (name/color), and project fields (name/description/repo_path/archived).

- [ ] **Step 1:** Store CRUD for states/labels/project (via `lib/pb/board.ts`). `deleteState` guard.
- [ ] **Step 2:** `ProjectSheet` UI (states list with add/edit/reorder/delete; labels list; project fields incl. `repo_path`; archive toggle).
- [ ] **Step 3: Verify** tsc + test green.
- [ ] **Step 4: Commit** `feat(board): project settings sheet (states/labels/repo_path)`.

---

## Task 11: retalk — Promote session-project to Board project

**Files:** Create `src/features/board/PromoteToProjectDialog.tsx`; modify `src/features/sessions/SessionListView.tsx` (add "提升为看板项目" on a project group).

**Interfaces:** From the session hub's project group (a `project_path`), open `PromoteToProjectDialog` prefilled with `name` = last path segment, `repo_path` = the project_path; user picks a template → `createProjectFromTemplate({name, repo_path, template})` (Task 7) → navigate to `/board?project=<id>`.

- [ ] **Step 1:** Add a "提升为看板项目" affordance on each project group header in `SessionListView`.
- [ ] **Step 2:** `PromoteToProjectDialog` (reuses `createProjectFromTemplate`; repo_path prefilled + read-only).
- [ ] **Step 3: Verify** tsc + test green.
- [ ] **Step 4: Commit** `feat(board): promote a session-project into a managed Board project`.

---

## Task 12: retalk — Create task from session + provenance backlink

**Files:** Create `src/features/board/CreateTaskFromSessionDialog.tsx`; modify `SessionCard`/`SessionPreviewPane` (add "建任务"), `TaskCard.tsx` (source badge + click → navigate).

**Interfaces:** From a session, open the dialog: `title` prefilled (session `last_prompt` or `first_prompt` truncated), `source_session_id`/`source_provider` from the session; user picks target project — **default to the `board_project` whose `repo_path == session.project_path`** if one exists (else pick any project or a "先提升" shortcut). On save → `createTask({..., source_session_id, source_provider, state: firstStateOfProject})`. `TaskCard` shows a "来源会话" badge when `source_session_id` set → click navigates to session hub locating that session.

- [ ] **Step 1:** `CreateTaskFromSessionDialog` (project picker defaulting via repo_path match; prefilled title + source fields).
- [ ] **Step 2:** Wire "建任务" on `SessionCard` + preview.
- [ ] **Step 3:** `TaskCard` source badge + navigation (to `/sessions` with the session selected — use a store field or query param; minimal: navigate + set `useSessionsStore` selected).
- [ ] **Step 4: Verify** tsc + test green.
- [ ] **Step 5: Commit** `feat(board): create task from session with provenance + backlink`.

---

## Task 13: retalk — Linked sessions panel + git status bar

**Files:** Create `src/features/board/LinkedSessionsPanel.tsx`, `GitStatusBar.tsx`; modify `KanbanBoard` (mount them in project detail), `src/lib/tauri/ipc.ts` (add `gitInfo`).

**Interfaces:** `ipc.gitInfo(path: string): Promise<{branch: string|null, dirty_count: number, is_repo: boolean}>` → `invoke("git_info", {path})`. `LinkedSessionsPanel` (given a project's `repo_path`): filters `useSessionsStore.sessions` where `session.project_path === repo_path`, renders session cards (reuse `SessionCard`; allow "建任务"/preview). `GitStatusBar` (given `repo_path`): calls `ipc.gitInfo`, shows branch + dirty count.

- [ ] **Step 1:** Add `gitInfo` to `ipc.ts`.
- [ ] **Step 2:** `LinkedSessionsPanel` (repo_path filter join). Only shown when project has `repo_path`.
- [ ] **Step 3:** `GitStatusBar` (calls gitInfo on mount; shows `⎇ branch · N 未提交` or hides if `!is_repo`).
- [ ] **Step 4:** Mount both in `KanbanBoard` project detail (panel right, git bar top) when `openedProject.repo_path` set.
- [ ] **Step 5: Verify** tsc + test green.
- [ ] **Step 6: Commit** `feat(board): linked sessions panel + git status bar (retalk join)`.

---

## Task 14: Realtime subscription (opened project only)

**Files:** Modify `src/store/board.ts` (subscribe on `openProject`, unsubscribe on close/switch).

**Interfaces:** on `openProject(id)`, subscribe to `board_tasks`/`board_project_states`/`board_project_labels` filtered to that project via `pb.collection(x).subscribe('*', cb, { filter: pb.filter("project = {:p}", {p:id}) })` (add these subscribe helpers to `lib/pb/board.ts`). Callback upserts/removes in the store (create/update → upsert by id; delete → remove). Keep the unsubscribe fns; call on project switch/unmount. YAGNI: only the opened project.

- [ ] **Step 1:** Add subscribe/unsubscribe helpers in `lib/pb/board.ts`.
- [ ] **Step 2:** Wire into `openProject`/close in the store (upsert-by-id reducer).
- [ ] **Step 3: Verify** tsc + test green.
- [ ] **Step 4: Commit** `feat(board): realtime subscription for opened project`.

---

## Task 15: Integration verification + acceptance

**Files:** Create `docs/superpowers/plans/board-acceptance-checklist.md`.

- [ ] **Step 1: Kill processes**, run full suites: `cd src-tauri && cargo test` (incl. git_info) + `cargo check`; `cd .. && pnpm exec tsc --noEmit` + `pnpm test`. Record counts.
- [ ] **Step 2: Live-PB write-path smoke** (the CI-blind paths): spawn PB (temp dir + migrations) + superuser + user token; via curl exercise: create project → create state → **create task** (with `source_session_id`, `created_by`, `priority` enum) → **PATCH task** `{state, rank}` (the drag path) → GET tasks. Confirm all 200 + fields correct + no rule rejection. **KILL PB after.** Record evidence.
- [ ] **Step 3:** Write the acceptance checklist (spec §8 items 1–7): items 1–5 GUI DEFERRED-MANUAL with per-item human steps; items 6–7 with automated + live-PB results filled in.
- [ ] **Step 4:** Fix any failure (systematic-debugging if needed).
- [ ] **Step 5: Commit** `test: board acceptance checklist + verification`.

---

## Self-Review notes (author)

- **Spec coverage:** §2 collections → Task 1; §5.1 types → Task 2; §4.6 git → Task 3; §3 rank → Task 4 + Task 8 (moveTask); §5.2 store → Task 5/7/8/10/14; §4.1 two-tier/promote → Task 11; §4.3 session→task + §4.5 backlink → Task 12; §4.4 linked sessions + git bar → Task 13; §1 frontend-orchestrated creation → Task 7; §6 isolation → enforced across FE tasks; §8 acceptance → Task 15.
- **Deferred per spec §7 (absent by design):** operation logs, member UI, owner transfer, task↔docs, assignees rich UI (field present, minimal UI in TaskSheet), AI extract, Dashboard, cross-table atomic tx (replaced by Task 7 orchestration+compensation).
- **Type consistency:** `BoardTask`/`BoardState` fields (snake_case) defined Task 2 used verbatim in Tasks 5–14; `rankBetween`/`nextRank`/`normalizeSortOrders` defined Task 4 used in Task 5/7/8/10; `createProjectFromTemplate` Task 7 used in Task 11; `git_info`/`GitInfo` Task 3 ↔ `ipc.gitInfo` Task 13; `groupTasksByState`/`moveTask` store methods consistent.
- **Live-PB verification points (flagged, not placeholders):** Task 1 Step 2 (migration + seed), Task 7 Step 3 (creation orchestration), Task 15 Step 2 (task create/PATCH drag path). PB 0.30 JSVM `new Record`/seed API to confirm at Task 1.
