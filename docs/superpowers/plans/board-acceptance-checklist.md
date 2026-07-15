# rework Board (Phase ②) — Acceptance Checklist

Date: 2026-07-15 · Branch: `feat/board` · Base: `master`

## Automated verification (recorded)

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | ✅ clean |
| `pnpm exec vitest run` | ✅ 21 passed / 0 failed |
| `cargo test` (src-tauri) | ✅ 51 passed (3 suites) |
| `cargo check` | ✅ clean |

## Live-PB write-path smoke (CI-blind paths)

Spawned the bundled PocketBase against a fresh temp dir with the repo migrations, created a
superuser + a `users` record + user token, then exercised the board write paths via the REST
API (user token → access rules enforced):

| Path | Result |
|---|---|
| Migrations apply on a fresh DB (15 collections present) | ✅ |
| POST `board_projects` (owner = auth id, repo_path) | ✅ created |
| POST `board_project_states` ×2 (category enum, sort_order) | ✅ created |
| POST `board_tasks` (priority enum, rank, created_by, source_session_id, source_provider) | ✅ created |
| PATCH `board_tasks` `{state, rank}` — **the drag path** | ✅ HTTP 200 |
| GET tasks after drag — state moved to S2, rank=1536, provenance intact | ✅ |

Cross-check (MVP, on master): `sessions_meta` PATCH → 200, `session_notes` PATCH → 200.
The `:changed` bug is **not** present in shipped migrations (already fixed in `init.js`).
PocketBase killed after every spawn.

## GUI flows — DEFERRED-MANUAL

The environment cannot drive `pnpm tauri dev`; the following are for a human pass.

1. **Create project from template** — Board → 新建项目 → pick a template + name (optional
   repo_path) → project appears in the list; opening it shows the template's state columns.
2. **Task create/edit** — open a project → column "+ 任务" opens TaskSheet (state prefilled) →
   create; click a card → edit (title/desc/state/priority/labels/due_date) → save persists.
3. **Drag & drop** — drag a card within/between columns → order + column persist after reload
   (rank via lexorank; PATCH verified above).
4. **Project settings** — 项目设置 → add/rename/recolor/reorder states, add/edit labels, edit
   name/description/repo_path, archive toggle; deleting a state that still has tasks is refused.
5. **retalk chemistry:**
   - **Promote** — session hub project group → 提升为看板项目 → template picker →
     creates a Board project with `repo_path = project_path` and opens it.
   - **Session → task** — session card / preview → 建任务 → target project defaults to the
     one whose `repo_path == session.project_path`; task carries `source_session_id`/`source_provider`.
   - **Backlink** — a task's 来源会话 badge navigates to the sessions route for that session.
   - **Linked sessions panel + git bar** — a project with `repo_path` shows its linked sessions
     (join on `project_path`) and a `⎇ branch · N 未提交` bar (Rust `git_info`).
6. **Realtime** — with the project open, a change from another client upserts/removes live
   (subscription filtered to the opened project; torn down on close/switch).
7. **Isolation invariants** — `invoke` only in `src/lib/tauri/ipc.ts`; `pb.collection` only in
   `src/lib/pb/*`; no hardcoded hex in framework UI (state/label colors are user data via inline
   style); neutral light+dark theme.

## Status

Board Tasks 1–15 complete. Automated + live-PB paths verified; GUI items 1–6 pending a manual pass.
