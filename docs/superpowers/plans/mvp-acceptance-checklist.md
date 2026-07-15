# MVP Acceptance Checklist — Phase 0 + ① (Rework)

> Generated: 2026-07-15  
> Branch: `feat/mvp-phase-0-1`  
> Verified by: Task 22 automated integration run

---

## §B.2 Acceptance Items

### GUI / Manual Items (cannot be driven in headless CI)

| # | Acceptance Criterion | Status | How to Verify (Human) |
|---|---------------------|--------|----------------------|
| 1 | **Hotkey → Spotlight** — global hotkey opens Spotlight overlay; user types and filters real sessions; `Enter` resumes the top hit; blur (click away / Esc) hides the overlay | ☐ DEFERRED-MANUAL | Launch app with `pnpm tauri dev`; press the configured hotkey (default `Ctrl+Space`); type partial session name; confirm filtered list; press `Enter` and verify Claude Code resumes that session; click away and confirm overlay hides. |
| 2 | **Main-window session hub** — sessions are grouped (by project or date), searchable via the top search bar, previewable (click shows summary pane), and resumable (double-click / Resume button launches Claude Code) | ☐ DEFERRED-MANUAL | Open main window; observe grouped session list; type in search bar and confirm client-side filter; click a session and verify preview pane populates; click Resume and verify Claude Code opens for that session. |
| 3 | **Favorite / note persists across restart** — marking a session as favorite and adding a note survives app quit-and-relaunch (stored in PocketBase, owner-scoped) | ☐ DEFERRED-MANUAL | Star a session and add a note; quit the app fully (`Cmd/Ctrl+Q`); relaunch; locate same session and confirm star and note text are preserved. |
| 4 | **Light + dark themes both neutral** — no hardcoded colours; Spotlight glass renders acceptably in both modes | ☐ DEFERRED-MANUAL | Toggle OS theme between Light and Dark while the app is open; inspect Spotlight overlay and main window for any jarring hardcoded colours; confirm Morandi / neutral palette holds in both modes. |
| 5 | **Resume works with main window closed** — multiwindow: Spotlight can resume a session even when the main hub window is closed | ☐ DEFERRED-MANUAL | Close the main hub window (leave tray icon active); invoke Spotlight via hotkey; select a session and press `Enter`; confirm Claude Code resumes successfully without requiring the main window to be open. |

---

### Automated Items

| # | Acceptance Criterion | Status | Evidence |
|---|---------------------|--------|----------|
| 6 | `cargo test` passes (core pure functions covered) and `pnpm test` passes | ✅ PASS | See §Evidence below |

---

## §Evidence — Automated Test Run (2026-07-15)

### Command 1: `cd src-tauri && cargo test`
```
cargo test: 48 passed (3 suites, 28.51s)
```
**Result: 48 tests PASSED, 0 failed, 3 test suites**

### Command 2: `pnpm test`
```
 RUN  v4.1.10 D:/workspace/rework

 Test Files  2 passed (2)
       Tests  17 passed (17)
    Start at  15:47:31
    Duration  562ms
```
**Result: 17 tests PASSED, 0 failed, 2 test files**

### Command 3: `pnpm exec tsc --noEmit`
```
TypeScript: No errors found
```
**Result: CLEAN — zero TypeScript type errors**

### Command 4: `cd src-tauri && cargo check`
```
Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.19s
```
**Result: CLEAN — zero Rust compilation errors or warnings**

---

## Summary

| Suite | Result | Count |
|-------|--------|-------|
| `cargo test` | ✅ PASS | 48 / 48 |
| `pnpm test` (Vitest) | ✅ PASS | 17 / 17 |
| `tsc --noEmit` | ✅ CLEAN | 0 errors |
| `cargo check` | ✅ CLEAN | 0 errors |

**All automated acceptance criteria are GREEN. GUI items 1–5 require a human tester with the running app.**
