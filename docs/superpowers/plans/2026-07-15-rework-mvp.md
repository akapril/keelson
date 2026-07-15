# rework MVP (Phase 0 + ①) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a personally-usable desktop app that scans, searches, previews, and resumes local AI-coding-CLI sessions via a Spotlight popup and a main window, on a Rust+Tauri+React+PocketBase-sidecar foundation.

**Architecture:** Tauri v2 desktop app. Rust core owns local powers (session scanning, Tantivy search, terminal resume) and manages a bundled PocketBase sidecar (127.0.0.1) that stores workbench/session metadata behind `owner`+access-rules. React frontend talks to PocketBase (JS SDK, via `lib/pb/*`) for data and to Rust (via `lib/tauri/ipc.ts`) for local powers — components never touch `pb`/`invoke` directly. Two windows (`main`, `spotlight`) share stores.

**Tech Stack:** Rust (Tauri v2, tantivy, jieba-rs, notify, rusqlite, reqwest, serde, keyring, parking_lot, tokio), React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui + Zustand + PocketBase JS SDK. PocketBase binary as Tauri `externalBin` sidecar.

## Global Constraints

- Platform target for MVP: **Windows** first (macOS/Linux terminal spawn deferred, but code compiles cross-platform).
- PocketBase sidecar binds **`127.0.0.1` only** — never `0.0.0.0`.
- Every PocketBase collection has an `owner` relation + access rules `owner = @request.auth.id` (single-user now, multi-user later, zero schema change).
- Components must not import `pocketbase` or call `invoke` directly — only via `lib/pb/*` and `lib/tauri/ipc.ts`.
- All colors via CSS variables (`var(--...)`) / Tailwind semantic classes — **no hardcoded hex/rgba**. Theme = clean neutral, light primary, light+dark both defined. **Not Morandi.**
- All new Rust comments in Chinese (per user global rule).
- Reference sources (read-only, do not modify): retalk `D:/workspace/retalk-claude`, workavera `D:/workspace/_tmp_workavera_analysis`.
- Frequent commits: one per task minimum. Conventional Commits. Every commit message ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- PocketBase version pin: **0.30.x** (latest stable at plan time); record exact version in `scripts/fetch-pocketbase.mjs`.

---

# PHASE 0 — Foundation

## Task 1: Scaffold Tauri v2 + React + Vite + TS + Tailwind v4

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`
- Modify: `.gitignore` (already present)

**Interfaces:**
- Produces: a runnable Tauri app; `pnpm tauri dev` opens a window rendering `<App/>`.

- [ ] **Step 1: Scaffold with the Tauri CLI**

Run (from `D:/workspace/rework`):
```bash
pnpm create tauri-app@latest . --template react-ts --manager pnpm --yes
```
If the directory-not-empty prompt blocks it, scaffold in a temp dir and copy `src/`, `src-tauri/`, and config files in, preserving our existing `docs/` and `.gitignore`.

- [ ] **Step 2: Add frontend deps**

Run:
```bash
pnpm add react@^19 react-dom@^19 react-router-dom zustand pocketbase @tauri-apps/api
pnpm add -D tailwindcss@^4 @tailwindcss/vite typescript vite @vitejs/plugin-react
pnpm add @tauri-apps/plugin-shell @tauri-apps/plugin-global-shortcut
```

- [ ] **Step 3: Wire Tailwind v4 into Vite**

`vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri 期望固定端口，且需暴露给 webview
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
});
```

`src/index.css` (top line only for now):
```css
@import "tailwindcss";
```

- [ ] **Step 4: Minimal App renders**

`src/App.tsx`:
```tsx
export default function App() {
  return <div className="p-6 text-lg">rework — booting…</div>;
}
```

- [ ] **Step 5: Run and verify the window opens**

Run: `pnpm tauri dev`
Expected: a native window opens showing "rework — booting…". Close it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri v2 + React 19 + Vite + Tailwind v4

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Neutral light/dark theme system

**Files:**
- Modify: `src/index.css`
- Create: `src/components/theme-provider.tsx`, `src/components/theme-toggle.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `<ThemeProvider>` (wraps app, applies `.dark` class, persists to `localStorage["rework-theme"]`, follows system), `useTheme()` hook returning `{ theme, setTheme }` where `theme: "light" | "dark" | "system"`.

- [ ] **Step 1: Define neutral tokens (light + dark) with oklch**

Append to `src/index.css` (values are neutral zinc/slate, NOT Morandi; light primary avoids pure white):
```css
:root {
  --radius: 0.625rem;
  --background: oklch(0.985 0.002 250);   /* 极浅暖中性，非纯白 */
  --foreground: oklch(0.21 0.006 250);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.21 0.006 250);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.21 0.006 250);
  --primary: oklch(0.45 0.03 250);        /* 克制的中性蓝灰强调 */
  --primary-foreground: oklch(0.985 0.002 250);
  --muted: oklch(0.955 0.004 250);
  --muted-foreground: oklch(0.5 0.01 250);
  --accent: oklch(0.955 0.004 250);
  --accent-foreground: oklch(0.21 0.006 250);
  --border: oklch(0.9 0.004 250);
  --input: oklch(0.9 0.004 250);
  --ring: oklch(0.45 0.03 250);
  --destructive: oklch(0.55 0.2 25);
  /* Spotlight / 玻璃层 —— 用 color-mix，禁止裸 rgba */
  --glass-surface: color-mix(in oklab, var(--card) 88%, transparent);
  --glass-border: color-mix(in oklab, var(--border) 70%, transparent);
  --glass-blur: 20px;
  --item-selected: oklch(0.93 0.006 250);
}
.dark {
  --background: oklch(0.2 0.005 250);
  --foreground: oklch(0.95 0.003 250);
  --card: oklch(0.24 0.006 250);
  --card-foreground: oklch(0.95 0.003 250);
  --popover: oklch(0.24 0.006 250);
  --popover-foreground: oklch(0.95 0.003 250);
  --primary: oklch(0.7 0.03 250);
  --primary-foreground: oklch(0.2 0.005 250);
  --muted: oklch(0.28 0.006 250);
  --muted-foreground: oklch(0.68 0.01 250);
  --accent: oklch(0.3 0.006 250);
  --accent-foreground: oklch(0.95 0.003 250);
  --border: oklch(0.32 0.006 250);
  --input: oklch(0.32 0.006 250);
  --ring: oklch(0.7 0.03 250);
  --destructive: oklch(0.7 0.19 25);
  --glass-surface: color-mix(in oklab, var(--card) 82%, transparent);
  --glass-border: color-mix(in oklab, var(--border) 60%, transparent);
  --item-selected: oklch(0.3 0.008 250);
}
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-destructive: var(--destructive);
  --radius-lg: var(--radius);
}
body { @apply bg-background text-foreground; }
```

- [ ] **Step 2: ThemeProvider**

`src/components/theme-provider.tsx`:
```tsx
import { createContext, useContext, useEffect, useState } from "react";
type Theme = "light" | "dark" | "system";
const KEY = "rework-theme";
const Ctx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: "system", setTheme: () => {},
});
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(KEY) as Theme) || "system",
  );
  useEffect(() => {
    const root = document.documentElement;
    const sys = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = theme === "dark" || (theme === "system" && sys);
    root.classList.toggle("dark", dark);
    localStorage.setItem(KEY, theme);
  }, [theme]);
  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);
```

- [ ] **Step 3: ThemeToggle + mount provider**

`src/components/theme-toggle.tsx`:
```tsx
import { useTheme } from "./theme-provider";
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <button
      className="rounded-md border border-border px-3 py-1 text-sm"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? "☾ 暗" : "☀ 明"}
    </button>
  );
}
```
`src/App.tsx`:
```tsx
import { ThemeProvider } from "./components/theme-provider";
import { ThemeToggle } from "./components/theme-toggle";
export default function App() {
  return (
    <ThemeProvider>
      <div className="min-h-screen p-6">
        <div className="flex items-center justify-between">
          <span className="text-lg">rework</span>
          <ThemeToggle />
        </div>
      </div>
    </ThemeProvider>
  );
}
```

- [ ] **Step 4: Verify toggle**

Run: `pnpm tauri dev`
Expected: window shows a theme toggle; clicking flips light/dark, background is neutral (not pure white in light), persists across reload.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(theme): neutral light/dark theme via Tailwind v4 @theme + oklch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Bundle PocketBase as a Tauri sidecar

**Files:**
- Create: `scripts/fetch-pocketbase.mjs`
- Create: `src-tauri/binaries/.gitkeep`
- Modify: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json` (scripts)
- Create: `src-tauri/capabilities/default.json`

**Interfaces:**
- Produces: `pocketbase-<target-triple>(.exe)` present in `src-tauri/binaries/` after `pnpm run fetch:pb`; Tauri config declares it as `externalBin`.

- [ ] **Step 1: Download script**

`scripts/fetch-pocketbase.mjs` (Node ≥18, uses global fetch; downloads the pinned PB release and renames to the Rust host target triple):
```js
// 下载 PocketBase 官方二进制并按 Tauri sidecar 命名规则(带 target triple)放入 src-tauri/binaries/
import { execSync } from "node:child_process";
import { mkdirSync, createWriteStream, existsSync, chmodSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createRequire } from "node:module";

const PB_VERSION = "0.30.0"; // 固定版本，升级需同步改这里
const triple = execSync("rustc -Vv").toString().match(/host: (\S+)/)[1];
const isWin = triple.includes("windows");
const platform = isWin ? "windows" : triple.includes("darwin") ? "darwin" : "linux";
const arch = triple.startsWith("aarch64") ? "arm64" : "amd64";
const zipName = `pocketbase_${PB_VERSION}_${platform}_${arch}.zip`;
const url = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${zipName}`;

const outDir = "src-tauri/binaries";
mkdirSync(outDir, { recursive: true });
const outBin = `${outDir}/pocketbase-${triple}${isWin ? ".exe" : ""}`;
if (existsSync(outBin)) { console.log("已存在:", outBin); process.exit(0); }

const zipPath = `${outDir}/${zipName}`;
console.log("下载", url);
const res = await fetch(url);
if (!res.ok) throw new Error(`下载失败 ${res.status}`);
await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));

// 解压(用系统 unzip / tar)。Windows 用 tar(自带)，其余用 unzip。
if (isWin) execSync(`tar -xf "${zipPath}" -C "${outDir}"`);
else execSync(`unzip -o "${zipPath}" -d "${outDir}"`);
const extracted = `${outDir}/pocketbase${isWin ? ".exe" : ""}`;
execSync(isWin ? `move /Y "${extracted}" "${outBin}"` : `mv -f "${extracted}" "${outBin}"`, { shell: true });
if (!isWin) chmodSync(outBin, 0o755);
console.log("就绪:", outBin);
```

`package.json` scripts add:
```json
"scripts": {
  "fetch:pb": "node scripts/fetch-pocketbase.mjs",
  "predev": "node scripts/fetch-pocketbase.mjs",
  "prebuild": "node scripts/fetch-pocketbase.mjs"
}
```

- [ ] **Step 2: Declare externalBin + shell capability**

`src-tauri/tauri.conf.json` — add under `bundle`:
```json
"externalBin": ["binaries/pocketbase"]
```
`src-tauri/capabilities/default.json` — ensure it includes:
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "windows": ["main", "spotlight"],
  "permissions": [
    "core:default",
    "shell:allow-execute",
    { "identifier": "shell:allow-spawn", "allow": [{ "name": "binaries/pocketbase", "sidecar": true }] },
    "global-shortcut:default"
  ]
}
```

`src-tauri/Cargo.toml` — add deps:
```toml
tauri-plugin-shell = "2"
tauri-plugin-global-shortcut = "2"
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
keyring = "3"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
parking_lot = "0.12"
anyhow = "1"
rand = "0.8"
```

- [ ] **Step 3: Fetch and verify**

Run: `pnpm run fetch:pb`
Expected: `src-tauri/binaries/pocketbase-<triple>.exe` exists.
Run: `./src-tauri/binaries/pocketbase-*.exe --version` (verify it prints `PocketBase v0.30.0`).

- [ ] **Step 4: Commit**

```bash
git add -A   # binaries/ is gitignored; only .gitkeep + config committed
git commit -m "chore(pb): bundle PocketBase 0.30.0 as Tauri sidecar (externalBin)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Rust PocketBase process lifecycle (`pb::process`)

**Files:**
- Create: `src-tauri/src/pb/mod.rs`, `src-tauri/src/pb/process.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - `pub struct PbHandle { pub base_url: String }`
  - `pub fn pick_free_port() -> u16`
  - `pub async fn wait_healthy(base_url: &str, timeout_ms: u64) -> anyhow::Result<()>`
  - `pub fn spawn_pocketbase(app: &tauri::AppHandle, data_dir: &Path, migrations_dir: &Path, port: u16) -> anyhow::Result<tauri_plugin_shell::process::CommandChild>`
- Consumes: nothing (first Rust task of Phase 0's PB layer).

- [ ] **Step 1: Write the failing test for port picking**

`src-tauri/src/pb/process.rs` (test section):
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pick_free_port_returns_bindable_loopback_port() {
        // 选出的端口应能被再次绑定(说明确实空闲)
        let p = pick_free_port();
        assert!(p >= 1024);
        let ok = std::net::TcpListener::bind(("127.0.0.1", p)).is_ok();
        assert!(ok, "端口 {p} 应可绑定");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test pb::process::tests::pick_free_port -- --nocapture`
Expected: FAIL to compile (`pick_free_port` not found).

- [ ] **Step 3: Implement process.rs**

`src-tauri/src/pb/process.rs`:
```rust
//! PocketBase sidecar 进程生命周期：端口选择、健康检查、启动。
use std::path::Path;
use std::time::Duration;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

pub struct PbHandle { pub base_url: String }

/// 让 OS 分配一个空闲端口(bind :0 后取端口号再释放)。
pub fn pick_free_port() -> u16 {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8790)
}

/// 轮询 /api/health，直到 200 或超时。
pub async fn wait_healthy(base_url: &str, timeout_ms: u64) -> anyhow::Result<()> {
    let client = reqwest::Client::new();
    let url = format!("{base_url}/api/health");
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        if let Ok(r) = client.get(&url).send().await {
            if r.status().is_success() { return Ok(()); }
        }
        if std::time::Instant::now() >= deadline {
            anyhow::bail!("PocketBase 健康检查超时");
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// 以 sidecar 方式启动 PocketBase，仅绑 127.0.0.1。
pub fn spawn_pocketbase(
    app: &tauri::AppHandle,
    data_dir: &Path,
    migrations_dir: &Path,
    port: u16,
) -> anyhow::Result<CommandChild> {
    let cmd = app.shell().sidecar("pocketbase")?.args([
        "serve",
        "--http", &format!("127.0.0.1:{port}"),
        "--dir", &data_dir.to_string_lossy(),
        "--migrationsDir", &migrations_dir.to_string_lossy(),
    ]);
    let (mut _rx, child) = cmd.spawn()?;
    Ok(child)
}
```

`src-tauri/src/pb/mod.rs`:
```rust
//! PocketBase 集成层：进程、客户端、首启初始化。
pub mod process;
pub mod bootstrap; // Task 5
pub mod client;    // Task 5
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test pb::process::tests::pick_free_port`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(pb): PocketBase sidecar process lifecycle (spawn/health/port)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: PB migrations + bootstrap (single-user auto-login)

**Files:**
- Create: `src-tauri/pb_migrations/1720000000_init.js`
- Create: `src-tauri/src/pb/client.rs`, `src-tauri/src/pb/bootstrap.rs`
- Modify: `src-tauri/tauri.conf.json` (bundle resources), `src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - PB collections: `sessions_meta`, `session_tags`, `session_notes` (+ extended `users`).
  - `pub struct BootstrapAuth { pub base_url: String, pub token: String, pub user_id: String }`
  - `pub async fn bootstrap(base_url: &str) -> anyhow::Result<BootstrapAuth>` — idempotent: ensures a superuser + a `local-user`, returns a user auth token (cached in OS keychain under service `rework`, account `local-user-token`).
  - `pub struct PbClient { base_url, token }` with `get/list/create/patch` helpers (reqwest).
- Consumes: `pb::process::{spawn_pocketbase, wait_healthy, pick_free_port}` from Task 4.

- [ ] **Step 1: Write migration (JS)**

`src-tauri/pb_migrations/1720000000_init.js`:
```js
// rework 初始迁移：扩展 users + 会话元数据三表。每表带 owner + access rules。
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new Field({ name: "displayName", type: "text", required: false }));
  app.save(users);

  const rules = {
    listRule: '@request.auth.id != "" && owner = @request.auth.id',
    viewRule: '@request.auth.id != "" && owner = @request.auth.id',
    createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id',
    updateRule: 'owner = @request.auth.id && @request.body.owner:changed = false',
    deleteRule: 'owner = @request.auth.id',
  };
  const ownerField = () => new Field({
    name: "owner", type: "relation", required: true,
    collectionId: app.findCollectionByNameOrId("users").id,
    cascadeDelete: true, maxSelect: 1,
  });

  // sessions_meta
  const meta = new Collection({ name: "sessions_meta", type: "base", ...rules });
  meta.fields.add(ownerField());
  meta.fields.add(new Field({ name: "session_id", type: "text", required: true }));
  meta.fields.add(new Field({ name: "provider", type: "text" }));
  meta.fields.add(new Field({ name: "project_path", type: "text" }));
  meta.fields.add(new Field({ name: "project_name", type: "text" }));
  meta.fields.add(new Field({ name: "custom_name", type: "text" }));
  meta.fields.add(new Field({ name: "favorite", type: "bool" }));
  meta.fields.add(new Field({ name: "hidden", type: "bool" }));
  meta.fields.add(new Field({ name: "last_prompt", type: "text" }));
  meta.fields.add(new Field({ name: "message_count", type: "number" }));
  meta.fields.add(new Field({ name: "total_tokens", type: "number" }));
  meta.fields.add(new Field({ name: "content_hash", type: "text" }));
  meta.fields.add(new Field({ name: "orphaned", type: "bool" }));
  meta.addIndex("idx_meta_owner_sid", true, "owner, session_id", "");
  app.save(meta);

  // session_tags
  const tags = new Collection({ name: "session_tags", type: "base", ...rules });
  tags.fields.add(ownerField());
  tags.fields.add(new Field({ name: "session_id", type: "text", required: true }));
  tags.fields.add(new Field({ name: "tag", type: "text", required: true, max: 60 }));
  tags.addIndex("idx_tags_unique", true, "owner, session_id, tag", "");
  app.save(tags);

  // session_notes
  const notes = new Collection({ name: "session_notes", type: "base", ...rules });
  notes.fields.add(ownerField());
  notes.fields.add(new Field({ name: "session_id", type: "text", required: true }));
  notes.fields.add(new Field({ name: "content", type: "text", max: 10000 }));
  notes.addIndex("idx_notes_unique", true, "owner, session_id", "");
  app.save(notes);
}, (app) => {
  for (const n of ["sessions_meta", "session_tags", "session_notes"]) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  }
});
```

> Verify field API against the pinned PB version's JSVM docs at `D:/workspace/_tmp_workavera_analysis/migrations/*.go` semantics; adjust `new Field({...})` shape if the 0.30 JSVM differs. Confirm by running the migration in Step 4.

- [ ] **Step 2: Bundle migrations as a resource**

`src-tauri/tauri.conf.json` — add under `bundle`:
```json
"resources": ["pb_migrations/*"]
```

- [ ] **Step 3: Implement client.rs + bootstrap.rs**

`src-tauri/src/pb/client.rs`:
```rust
//! PB REST 薄客户端(reqwest)。仅覆盖本产品用到的端点。
use serde_json::Value;

#[derive(Clone)]
pub struct PbClient { pub base_url: String, pub token: String }

impl PbClient {
    pub fn new(base_url: &str, token: &str) -> Self {
        Self { base_url: base_url.into(), token: token.into() }
    }
    fn http(&self) -> reqwest::Client { reqwest::Client::new() }

    /// 按 filter 取一条记录(用于 upsert 前查存在)。
    pub async fn find_one(&self, coll: &str, filter: &str) -> anyhow::Result<Option<Value>> {
        let url = format!("{}/api/collections/{coll}/records", self.base_url);
        let r = self.http().get(&url)
            .bearer_auth(&self.token)
            .query(&[("filter", filter), ("perPage", "1")])
            .send().await?.error_for_status()?;
        let body: Value = r.json().await?;
        Ok(body["items"].as_array().and_then(|a| a.first()).cloned())
    }
    pub async fn create(&self, coll: &str, data: &Value) -> anyhow::Result<Value> {
        let url = format!("{}/api/collections/{coll}/records", self.base_url);
        Ok(self.http().post(&url).bearer_auth(&self.token).json(data)
            .send().await?.error_for_status()?.json().await?)
    }
    pub async fn patch(&self, coll: &str, id: &str, data: &Value) -> anyhow::Result<Value> {
        let url = format!("{}/api/collections/{coll}/records/{id}", self.base_url);
        Ok(self.http().patch(&url).bearer_auth(&self.token).json(data)
            .send().await?.error_for_status()?.json().await?)
    }
    pub async fn list_all(&self, coll: &str, fields: &str) -> anyhow::Result<Vec<Value>> {
        let url = format!("{}/api/collections/{coll}/records", self.base_url);
        let r = self.http().get(&url).bearer_auth(&self.token)
            .query(&[("perPage", "500"), ("fields", fields)])
            .send().await?.error_for_status()?;
        let body: Value = r.json().await?;
        Ok(body["items"].as_array().cloned().unwrap_or_default())
    }
}
```

`src-tauri/src/pb/bootstrap.rs`:
```rust
//! 首启初始化：确保 superuser + local-user，返回用户 token(缓存 keychain)。
use serde::Serialize;
use serde_json::{json, Value};

pub struct BootstrapAuth { pub base_url: String, pub token: String, pub user_id: String }

const SUPERUSER_EMAIL: &str = "local@app.internal";
const LOCAL_EMAIL: &str = "you@local.rework";
const KEYRING_SERVICE: &str = "rework";

fn keyring_entry(account: &str) -> keyring::Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, account)
}
fn get_or_make_secret(account: &str) -> String {
    if let Ok(e) = keyring_entry(account) {
        if let Ok(pw) = e.get_password() { return pw; }
        let pw: String = {
            use rand::Rng;
            rand::thread_rng().sample_iter(&rand::distributions::Alphanumeric)
                .take(32).map(char::from).collect()
        };
        let _ = e.set_password(&pw);
        return pw;
    }
    "rework-fallback-pass-please-rotate".into()
}

pub async fn bootstrap(base_url: &str) -> anyhow::Result<BootstrapAuth> {
    let http = reqwest::Client::new();
    let super_pw = get_or_make_secret("superuser-pw");
    let user_pw = get_or_make_secret("local-user-pw");

    // 1) 确保 superuser(幂等：已存在则登录失败可忽略，用 auth 验证)
    ensure_superuser(&http, base_url, SUPERUSER_EMAIL, &super_pw).await?;
    let admin_token = admin_login(&http, base_url, SUPERUSER_EMAIL, &super_pw).await?;

    // 2) 确保 local-user
    let user_id = ensure_user(&http, base_url, &admin_token, LOCAL_EMAIL, &user_pw).await?;

    // 3) 用 local-user 登录拿 user token
    let token = user_login(&http, base_url, LOCAL_EMAIL, &user_pw).await?;
    Ok(BootstrapAuth { base_url: base_url.into(), token, user_id })
}

async fn ensure_superuser(http: &reqwest::Client, base: &str, email: &str, pw: &str) -> anyhow::Result<()> {
    // 尝试登录；失败则通过 superuser 创建端点新建(PB 0.30: /api/collections/_superusers/records 需已认证，
    // 首个 superuser 用 CLI 更稳 —— 见备选)。这里用 auth 探测是否已存在。
    if admin_login(http, base, email, pw).await.is_ok() { return Ok(()); }
    // 备选:用打包的 sidecar CLI `superuser upsert` 创建首个管理员(见 lib.rs 调用点注释)。
    anyhow::bail!("首个 superuser 需由 CLI 创建 —— 见 lib.rs bootstrap 前置步骤");
}
async fn admin_login(http: &reqwest::Client, base: &str, email: &str, pw: &str) -> anyhow::Result<String> {
    #[derive(Serialize)] struct A<'a>{ identity:&'a str, password:&'a str }
    let r = http.post(format!("{base}/api/collections/_superusers/auth-with-password"))
        .json(&A{identity:email,password:pw}).send().await?.error_for_status()?;
    let v: Value = r.json().await?;
    Ok(v["token"].as_str().unwrap_or_default().to_string())
}
async fn ensure_user(http: &reqwest::Client, base: &str, admin_token: &str, email: &str, pw: &str) -> anyhow::Result<String> {
    // 存在则返回其 id，否则创建。
    let existing = http.get(format!("{base}/api/collections/users/records"))
        .bearer_auth(admin_token)
        .query(&[("filter", format!("email='{email}'").as_str()), ("perPage","1")])
        .send().await?.error_for_status()?.json::<Value>().await?;
    if let Some(u) = existing["items"].as_array().and_then(|a| a.first()) {
        return Ok(u["id"].as_str().unwrap_or_default().to_string());
    }
    let created = http.post(format!("{base}/api/collections/users/records"))
        .bearer_auth(admin_token)
        .json(&json!({ "email": email, "password": pw, "passwordConfirm": pw, "displayName": "me" }))
        .send().await?.error_for_status()?.json::<Value>().await?;
    Ok(created["id"].as_str().unwrap_or_default().to_string())
}
async fn user_login(http: &reqwest::Client, base: &str, email: &str, pw: &str) -> anyhow::Result<String> {
    #[derive(Serialize)] struct A<'a>{ identity:&'a str, password:&'a str }
    let r = http.post(format!("{base}/api/collections/users/auth-with-password"))
        .json(&A{identity:email,password:pw}).send().await?.error_for_status()?;
    let v: Value = r.json().await?;
    Ok(v["token"].as_str().unwrap_or_default().to_string())
}
```

> **First-superuser bootstrapping:** because PB 0.30 requires auth to create the first superuser via REST, in `lib.rs` (Step 4) run the sidecar once with `superuser upsert <email> <pw>` *before* `serve`, OR call `pocketbase superuser upsert` via `app.shell().sidecar(...)` on first launch. The `ensure_superuser` REST path then just verifies. Confirm the exact 0.30 subcommand with `pocketbase --help`.

- [ ] **Step 4: Wire into lib.rs setup + expose IPC**

`src-tauri/src/lib.rs` (setup excerpt):
```rust
mod pb;
mod commands; // Task 16 (create empty stub now)

use std::sync::Arc;
use parking_lot::Mutex;

#[derive(Default)]
pub struct AppState { pub auth: Arc<Mutex<Option<pb::bootstrap::BootstrapAuth>>> }

#[tauri::command]
fn get_bootstrap_auth(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    let g = state.auth.lock();
    let a = g.as_ref().ok_or("尚未初始化")?;
    Ok(serde_json::json!({ "baseUrl": a.base_url, "token": a.token, "userId": a.user_id }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let state: tauri::State<AppState> = app.state();
            let auth_slot = state.auth.clone();
            let data_dir = app.path().app_data_dir().unwrap().join("pb_data");
            let mig_dir = app.path().resolve("pb_migrations", tauri::path::BaseDirectory::Resource).unwrap();
            std::fs::create_dir_all(&data_dir).ok();
            tauri::async_runtime::spawn(async move {
                let port = pb::process::pick_free_port();
                let base = format!("http://127.0.0.1:{port}");
                // 首个 superuser（幂等）—— 见 bootstrap.rs 注释
                let _child = pb::process::spawn_pocketbase(&handle, &data_dir, &mig_dir, port)
                    .expect("启动 PocketBase 失败");
                pb::process::wait_healthy(&base, 15000).await.expect("PB 健康检查失败");
                let auth = pb::bootstrap::bootstrap(&base).await.expect("bootstrap 失败");
                *auth_slot.lock() = Some(auth);
                // TODO(Task 15): 挂载会话扫描→PB 同步任务
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_bootstrap_auth])
        .run(tauri::generate_context!())
        .expect("运行 rework 失败");
}
```
Create empty `src-tauri/src/commands/mod.rs` with `// 命令模块占位` so the `mod commands;` compiles.

- [ ] **Step 5: Run app, verify PB comes up and bootstrap succeeds**

Run: `pnpm tauri dev`
Expected: no panic; `src-tauri/pb_data/` gets created; PB admin reachable at the chosen port (check logs). In devtools console you can later call the bootstrap IPC.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(pb): migrations + single-user bootstrap with keychain token

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frontend gateways (`lib/pb/*`, `lib/tauri/ipc.ts`) + health screen

**Files:**
- Create: `src/lib/pb.ts`, `src/lib/pb/collections.ts`, `src/lib/tauri/ipc.ts`, `src/lib/tauri/window.ts`, `src/lib/tauri/events.ts`
- Create: `src/store/auth.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces:
  - `pb` (PocketBase singleton), `initPbAuth(): Promise<void>` (calls `get_bootstrap_auth` IPC → `pb.authStore.save`).
  - `ipc` object — the ONLY place `invoke` appears. Method for MVP probe: `ipc.ping(): Promise<string>`.
  - `useAuthStore` (Zustand) with `{ ready: boolean, error?: string, init(): Promise<void> }`.
- Consumes: `get_bootstrap_auth` IPC (Task 5), `ipc.ping` → `ping` command (add a trivial `ping` command in `commands/mod.rs`).

- [ ] **Step 1: Add a trivial `ping` command (Rust)**

`src-tauri/src/commands/mod.rs`:
```rust
//! 命令模块。MVP 探针 + 后续分域(Task 16)。
#[tauri::command]
pub fn ping() -> String { "pong".into() }
```
Register in `lib.rs` `generate_handler![get_bootstrap_auth, commands::ping]`.

- [ ] **Step 2: PB singleton + auth init**

`src/lib/pb.ts`:
```ts
import PocketBase from "pocketbase";
import { invoke } from "@tauri-apps/api/core";
// 组件禁止直接 import 本文件的 pb 之外的东西；数据访问走 lib/pb/collections.ts
export const pb = new PocketBase("http://127.0.0.1:0"); // 占位，init 时覆盖 baseUrl

export async function initPbAuth(): Promise<void> {
  const a = await invoke<{ baseUrl: string; token: string; userId: string }>("get_bootstrap_auth");
  pb.baseUrl = a.baseUrl;
  // 单用户免登录：用 Rust 派发的 token 直接落 authStore
  pb.authStore.save(a.token, { id: a.userId, collectionName: "users" } as any);
}
export const currentUserId = () => pb.authStore.record?.id ?? "";
```
> `get_bootstrap_auth` is called here (not in `lib/tauri/ipc.ts`) because it is auth plumbing tied to `pb`. All *feature* commands go through `ipc.ts`.

- [ ] **Step 3: Typed IPC gateway**

`src/lib/tauri/ipc.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
// 唯一允许出现 invoke 字符串命令名的地方。新增本地能力只加一个方法。
export const ipc = {
  ping: () => invoke<string>("ping"),
  // Task 16 起补充：scanSessions / searchSessions / restoreSessions / getEcosystem ...
};
```
`src/lib/tauri/window.ts`:
```ts
import { getCurrentWindow } from "@tauri-apps/api/window";
export const thisWindowLabel = () => getCurrentWindow().label;
export const hideThisWindow = () => getCurrentWindow().hide();
export const showThisWindow = () => getCurrentWindow().show();
```
`src/lib/tauri/events.ts`:
```ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
export function on<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  return listen<T>(event, (e) => cb(e.payload));
}
```

- [ ] **Step 4: Collections helper + auth store**

`src/lib/pb/collections.ts`:
```ts
import { pb } from "../pb";
export const COL = {
  sessionsMeta: "sessions_meta",
  sessionTags: "session_tags",
  sessionNotes: "session_notes",
} as const;
export const list = <T>(coll: string, opts: Record<string, unknown> = {}) =>
  pb.collection(coll).getFullList<T>({ requestKey: null, ...opts });
export const create = <T>(coll: string, data: Record<string, unknown>) =>
  pb.collection(coll).create<T>(data);
export const update = <T>(coll: string, id: string, data: Record<string, unknown>) =>
  pb.collection(coll).update<T>(id, data);
```
`src/store/auth.ts`:
```ts
import { create } from "zustand";
import { initPbAuth } from "../lib/pb";
type S = { ready: boolean; error?: string; init: () => Promise<void> };
export const useAuthStore = create<S>((set) => ({
  ready: false,
  init: async () => {
    try { await initPbAuth(); set({ ready: true }); }
    catch (e) { set({ error: String(e) }); }
  },
}));
```

- [ ] **Step 5: Health screen wiring**

`src/App.tsx`:
```tsx
import { useEffect, useState } from "react";
import { ThemeProvider } from "./components/theme-provider";
import { ThemeToggle } from "./components/theme-toggle";
import { useAuthStore } from "./store/auth";
import { ipc } from "./lib/tauri/ipc";

export default function App() {
  const { ready, error, init } = useAuthStore();
  const [pong, setPong] = useState("");
  useEffect(() => { init(); ipc.ping().then(setPong); }, [init]);
  return (
    <ThemeProvider>
      <div className="min-h-screen p-6">
        <div className="flex items-center justify-between">
          <span className="text-lg">rework</span><ThemeToggle />
        </div>
        <ul className="mt-6 space-y-1 text-sm text-muted-foreground">
          <li>Tauri IPC: {pong === "pong" ? "✓ 通" : "…"}</li>
          <li>PocketBase: {ready ? "✓ 已登录" : error ? `✗ ${error}` : "…"}</li>
        </ul>
      </div>
    </ThemeProvider>
  );
}
```

- [ ] **Step 6: Verify both pipes green**

Run: `pnpm tauri dev`
Expected: after PB starts, both lines show ✓ (Tauri IPC 通 + PocketBase 已登录).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(fe): dual gateways (lib/pb, lib/tauri/ipc) + health screen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Main window layout + empty sidebar + router

**Files:**
- Create: `src/router.tsx`, `src/components/layout/MainWindowLayout.tsx`, `src/components/layout/AppSidebar.tsx`, `src/pages/sessions.tsx` (placeholder), `src/pages/settings.tsx` (placeholder)
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `<AppRouter/>` (HashRouter with `/sessions`, `/settings`), `<MainWindowLayout/>` (sidebar + `<Outlet/>`).

- [ ] **Step 1: Router + layout + placeholders**

`src/router.tsx`:
```tsx
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { MainWindowLayout } from "./components/layout/MainWindowLayout";
import Sessions from "./pages/sessions";
import Settings from "./pages/settings";
export function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<MainWindowLayout />}>
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/sessions" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
```
`src/components/layout/AppSidebar.tsx`:
```tsx
import { NavLink } from "react-router-dom";
const items = [ { to: "/sessions", label: "会话中枢" }, { to: "/settings", label: "设置" } ];
export function AppSidebar() {
  return (
    <nav className="w-48 shrink-0 border-r border-border p-2">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to}
          className={({ isActive }) =>
            `block rounded-md px-3 py-2 text-sm ${isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted"}`}>
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}
```
`src/components/layout/MainWindowLayout.tsx`:
```tsx
import { Outlet } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { ThemeToggle } from "../theme-toggle";
export function MainWindowLayout() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <AppSidebar />
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-sm font-medium">rework</span><ThemeToggle />
        </header>
        <main className="flex-1 overflow-auto p-4"><Outlet /></main>
      </div>
    </div>
  );
}
```
`src/pages/sessions.tsx`: `export default function Sessions(){ return <div>会话中枢（占位）</div>; }`
`src/pages/settings.tsx`: `export default function Settings(){ return <div>设置（占位）</div>; }`

- [ ] **Step 2: App mounts router after auth ready**

`src/App.tsx` — replace body with: keep `ThemeProvider`; call `init()` + render `<AppRouter/>` when `ready`, else a small "启动中…/错误" panel.

- [ ] **Step 3: Verify shell**

Run: `pnpm tauri dev`
Expected: sidebar with 会话中枢/设置; clicking navigates; theme toggle works; default route redirects to /sessions.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(fe): main window layout + sidebar + hash router

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**✅ Phase 0 acceptance:** app boots, PB sidecar runs, both pipes ✓, neutral light/dark theme, main shell navigable.

---

# PHASE ① — Session hub + Spotlight

> Port note: retalk source lives at `D:/workspace/retalk-claude/src-tauri/src/`. Where a step says "port from retalk `<file>`", copy the parsing/logic body, adapt to the new signature given in the task's **Interfaces**, keep Chinese comments, and add the specified tests. Do not re-transcribe retalk verbatim into this plan — open the referenced file.

## Task 8: Core models + AppPaths

**Files:**
- Create: `src-tauri/src/models.rs`, `src-tauri/src/paths.rs`
- Modify: `src-tauri/src/lib.rs` (`mod models; mod paths;`)

**Interfaces:**
- Produces:
  - `Session` struct — port verbatim from retalk `models.rs` (fields: `session_id, provider, project_path, project_name, first_prompt, last_prompt, created_at, updated_at, message_count, user_messages: Vec<String>, total_tokens`), `#[derive(Serialize, Deserialize, Clone)]`.
  - `TimelineMessage { role: String, content: String, timestamp: String }`.
  - `SessionMeta` (subset synced to PB): `session_id, provider, project_path, project_name, last_prompt, message_count, total_tokens, content_hash`.
  - `AppPaths { home: PathBuf, app_data: PathBuf }` with `fn claude_dir(&self)`, `fn codex_dir(&self)` etc. (replaces retalk's hardcoded `~/.claude/retalk/`).

- [ ] **Step 1:** Port `Session` + add `TimelineMessage`, `SessionMeta` into `models.rs` (Chinese comments).
- [ ] **Step 2:** Write `paths.rs` with `AppPaths::detect()` using `dirs` crate (`pnpm`/cargo add `dirs = "5"`).
- [ ] **Step 3: Test** — `#[test] fn app_paths_detects_home()` asserts `AppPaths::detect().home` exists.
- [ ] **Step 4:** Run `cargo test paths` → PASS.
- [ ] **Step 5: Commit** `feat(core): Session/TimelineMessage/SessionMeta models + AppPaths`.

---

## Task 9: `SessionProvider` trait (4 responsibilities) + `ProviderRegistry`

**Files:**
- Create: `src-tauri/src/providers/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces (this is the load-bearing SOLID refactor — full definition here):
```rust
use std::path::{Path, PathBuf};
use crate::models::{Session, TimelineMessage};

pub struct WatchRoot { pub path: PathBuf, pub recursive: bool }
#[derive(Debug, PartialEq)]
pub enum EventKind { Ignore, Incremental, FullRescan }

pub trait SessionProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn is_available(&self) -> bool;
    fn watch_roots(&self) -> Vec<WatchRoot>;
    fn refresh_probe_paths(&self) -> Vec<PathBuf>;
    fn scan_all(&self) -> Vec<Session>;
    fn classify_event(&self, path: &Path) -> EventKind;
    fn scan_one(&self, path: &Path) -> Option<Session>;
    fn resume_command(&self, project_path: &str, session_id: &str) -> String;
    fn read_timeline(&self, session_id: &str) -> Vec<TimelineMessage>;
}

pub struct ProviderRegistry { providers: Vec<Box<dyn SessionProvider>> }
impl ProviderRegistry {
    pub fn new() -> Self { /* push claude, codex (Task 10/11) */ Self { providers: vec![] } }
    pub fn installed(&self) -> impl Iterator<Item = &dyn SessionProvider> {
        self.providers.iter().map(|b| b.as_ref()).filter(|p| p.is_available())
    }
    pub fn by_id(&self, id: &str) -> Option<&dyn SessionProvider> {
        self.providers.iter().map(|b| b.as_ref()).find(|p| p.id() == id)
    }
    /// watcher/scanner 用：某路径归哪个 provider + 该走增量还是全量。
    pub fn route_path(&self, path: &Path) -> Option<(&dyn SessionProvider, EventKind)> {
        for p in self.providers.iter().map(|b| b.as_ref()) {
            let k = p.classify_event(path);
            if k != EventKind::Ignore { return Some((p, k)); }
        }
        None
    }
    pub fn all_watch_roots(&self) -> Vec<WatchRoot> {
        self.installed().flat_map(|p| p.watch_roots()).collect()
    }
    pub fn scan_all(&self) -> Vec<Session> {
        self.installed().flat_map(|p| p.scan_all()).collect()
    }
}
```

- [ ] **Step 1:** Write the trait + registry as above (registry starts empty).
- [ ] **Step 2: Write failing test** for routing using a fake provider:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    struct Fake;
    impl SessionProvider for Fake {
        fn id(&self)->&'static str{"fake"} fn display_name(&self)->&'static str{"Fake"}
        fn is_available(&self)->bool{true}
        fn watch_roots(&self)->Vec<WatchRoot>{vec![]}
        fn refresh_probe_paths(&self)->Vec<PathBuf>{vec![]}
        fn scan_all(&self)->Vec<Session>{vec![]}
        fn classify_event(&self,p:&Path)->EventKind{
            if p.to_string_lossy().contains(".fake"){EventKind::Incremental}else{EventKind::Ignore}
        }
        fn scan_one(&self,_:&Path)->Option<Session>{None}
        fn resume_command(&self,_:&str,_:&str)->String{String::new()}
        fn read_timeline(&self,_:&str)->Vec<TimelineMessage>{vec![]}
    }
    #[test]
    fn routes_by_classify_event() {
        let reg = ProviderRegistry{ providers: vec![Box::new(Fake)] };
        let (p, k) = reg.route_path(Path::new("/x/.fake/a.jsonl")).unwrap();
        assert_eq!(p.id(), "fake"); assert_eq!(k, EventKind::Incremental);
        assert!(reg.route_path(Path::new("/x/other/a.jsonl")).is_none());
    }
}
```
- [ ] **Step 3:** Run `cargo test providers::tests::routes_by_classify_event` → FAIL then implement → PASS.
- [ ] **Step 4: Commit** `feat(providers): 4-responsibility SessionProvider trait + registry`.

---

## Task 10: Claude provider

**Files:**
- Create: `src-tauri/src/providers/claude.rs`, `src-tauri/tests/fixtures/claude/*.jsonl`
- Modify: `src-tauri/src/providers/mod.rs` (register), `Cargo.toml` (add `chrono`, `dirs` if not present)

**Interfaces:**
- Produces: `pub struct ClaudeProvider;` implementing `SessionProvider`.
- Consumes: trait from Task 9; `Session`/`TimelineMessage` from Task 8.

**Port map (from retalk):**
- `scan_all` ← `providers/claude.rs::scan_all` (two-phase: history.jsonl path map + per-session parse).
- `scan_one` ← `scanner.rs` claude branch + `providers/claude.rs::parse_session_file`.
- `classify_event`: return `Incremental` if path under `~/.claude/projects` ends `.jsonl`; `FullRescan` if it's `history.jsonl`; else `Ignore`.
- `resume_command`: `format!("claude --resume {session_id}")` (retalk `terminal.rs:build_resume_command` claude arm).
- `read_timeline` ← `timeline.rs` claude branch.
- `watch_roots`: `[~/.claude/projects (recursive)]`; `refresh_probe_paths`: `[~/.claude/history.jsonl]`.
- Port the pure helpers `encode_project_path` / `decode_project_dir` / `extract_text_content` verbatim.

- [ ] **Step 1: Write failing tests for pure helpers** (`providers/claude.rs` tests):
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn path_encode_decode_roundtrip_windows() {
        assert_eq!(decode_project_dir("D--workspace-rework"), "D:\\workspace\\rework");
    }
    #[test]
    fn extract_text_handles_string_and_array() {
        assert_eq!(extract_text_content(&serde_json::json!("hi")), "hi");
        let arr = serde_json::json!([{"type":"text","text":"a"},{"type":"text","text":"b"}]);
        assert_eq!(extract_text_content(&arr), "a\nb");
    }
}
```
- [ ] **Step 2:** Run → FAIL (functions missing).
- [ ] **Step 3:** Port `ClaudeProvider` + helpers from retalk into the new trait shape; register `Box::new(ClaudeProvider)` in `ProviderRegistry::new()`.
- [ ] **Step 4:** Add a small anonymized `tests/fixtures/claude/sample.jsonl` and a test `scan_one_parses_fixture()` asserting the resulting `Session.session_id`/`message_count`.
- [ ] **Step 5:** Run `cargo test providers::claude` → PASS.
- [ ] **Step 6: Commit** `feat(providers): Claude provider (scan/timeline/resume) + tests`.

---

## Task 11: Codex provider

**Files:** Create `src-tauri/src/providers/codex.rs`, `tests/fixtures/codex/sample.jsonl`; register in `mod.rs`.

**Interfaces:** `pub struct CodexProvider;` implementing `SessionProvider`.

**Port map (from retalk `providers/codex.rs`):** JSONL with `type` discriminator (`session_meta`→id/cwd, `event_msg`→user text + token accum). `classify_event`: under `~/.codex/sessions` + `.jsonl` → `Incremental`. `resume_command`: `format!("codex resume {session_id}")`. `watch_roots`: `[~/.codex/sessions (recursive)]`.

- [ ] **Step 1:** Write test `scan_one_parses_codex_fixture()` (assert id + user message extracted).
- [ ] **Step 2:** FAIL → port `CodexProvider` → register.
- [ ] **Step 3:** `cargo test providers::codex` → PASS.
- [ ] **Step 4: Commit** `feat(providers): Codex provider + tests`.

---

## Task 12: Scanner + updater (registry-driven, no match)

**Files:** Create `src-tauri/src/scanner.rs`, `src-tauri/src/updater.rs`; modify `lib.rs`.

**Interfaces:**
- Produces:
  - `pub fn scan_all(reg: &ProviderRegistry) -> Vec<Session>` (delegates to `reg.scan_all()`).
  - `pub fn scan_single(reg: &ProviderRegistry, path: &Path) -> Option<Session>` (uses `reg.route_path`).
  - `pub struct Watcher` wrapping `notify`, watching `reg.all_watch_roots()`, emitting changed `Session`s via a callback.

**Port map:** retalk `scanner.rs` (drop the `match`), `updater.rs` watcher (roots from registry, classify via `route_path`).

- [ ] **Step 1: Test** `scan_single_routes_via_registry()` — build registry with Claude, feed a fixture path, assert a `Session` returns.
- [ ] **Step 2:** FAIL → implement scanner delegating to registry.
- [ ] **Step 3:** Implement `updater::Watcher` (notify) using `reg.all_watch_roots()`; on event → `reg.route_path` → `scan_single` or mark full-rescan.
- [ ] **Step 4:** `cargo test scanner` → PASS.
- [ ] **Step 5: Commit** `feat(core): registry-driven scanner + notify watcher`.

---

## Task 13: Tantivy indexer + search backend

**Files:** Create `src-tauri/src/indexer.rs`, `src-tauri/src/search/mod.rs`, `src-tauri/src/search/session_backend.rs`; `Cargo.toml` add `tantivy`, `jieba-rs`.

**Interfaces:**
- Produces:
  - `SessionIndex` with `new(dir)`, `rebuild(&[Session])`, `incremental_sync(&[Session])`, `upsert(&Session)`, `delete(session_id)`.
  - `search::session_backend::search(index, query, limit) -> Vec<SessionHit>` where `SessionHit { session_id, project_name, snippet, provider, updated_at, score }`.

**Port map:** retalk `indexer.rs` (keep schema + jieba tokenizer; apply the reusable-`IndexWriter` fix) + `searcher.rs` → `session_backend.rs` (keep 3-tier fallback + path regex). Keep tests for `escape_query`/`build_fallback_query`.

- [ ] **Step 1: Test** port retalk query-escape tests + add `index_roundtrip()`: rebuild with 2 fake sessions → search hits one → incremental delete → gone.
- [ ] **Step 2:** FAIL → port indexer + session_backend.
- [ ] **Step 3:** `cargo test search:: indexer::` → PASS.
- [ ] **Step 4: Commit** `feat(search): Tantivy+jieba session index + query backend + tests`.

---

## Task 14: Terminal resume (LaunchPlan pure fn + spawn)

**Files:** Create `src-tauri/src/terminal/mod.rs`, `terminal/kind.rs`, `terminal/plan.rs`, `terminal/spawn.rs`.

**Interfaces:**
- Produces:
  - `enum TerminalKind { WindowsTerminal, PowerShell, Cmd, /* mac/linux variants */ Custom(String) }`
  - `fn detect_terminal(pref: &str) -> TerminalKind`
  - `struct ResumeRequest { project_path: String, resume_cmd: String }` (`resume_cmd` comes from `provider.resume_command`)
  - `enum LaunchPlan { Program { program: String, args: Vec<String> }, Script { program: String, script: String } }`
  - `fn build_plan(kind: &TerminalKind, req: &ResumeRequest) -> LaunchPlan` — **pure, tested**
  - `fn execute(plan: LaunchPlan) -> anyhow::Result<()>` — thin `std::process::Command` (untested IO)

**Port map:** retalk `terminal.rs` — split "build args/script" (→ `plan.rs`, returns `LaunchPlan`, no spawn) from spawn (`spawn.rs`). Provider tool command now comes from `provider.resume_command` (Task 9), not a `match` here.

- [ ] **Step 1: Test** `build_plan` for Windows Terminal:
```rust
#[test]
fn wt_plan_includes_cd_and_resume() {
    let req = ResumeRequest { project_path: "D:\\p".into(), resume_cmd: "claude --resume abc".into() };
    let plan = build_plan(&TerminalKind::WindowsTerminal, &req);
    if let LaunchPlan::Program { program, args } = plan {
        assert_eq!(program, "wt.exe");
        let joined = args.join(" ");
        assert!(joined.contains("cd /d"));
        assert!(joined.contains("claude --resume abc"));
    } else { panic!("应为 Program plan"); }
}
```
- [ ] **Step 2:** FAIL → implement `kind.rs` (`detect_terminal`) + `plan.rs` (`build_plan`, port arg/script assembly) + `spawn.rs` (`execute`).
- [ ] **Step 3:** `cargo test terminal::` → PASS.
- [ ] **Step 4: Commit** `feat(terminal): LaunchPlan pure-fn build + spawn split + tests`.

---

## Task 15: Session metadata sync → PocketBase

**Files:** Create `src-tauri/src/sync.rs`; modify `lib.rs` (mount sync task after bootstrap + first scan).

**Interfaces:**
- Produces:
  - `fn content_hash(s: &Session) -> String` (hash of `updated_at + message_count + last_prompt`).
  - `async fn sync_to_pb(client: &PbClient, owner_id: &str, sessions: &[Session]) -> anyhow::Result<()>` — for each session: find by `filter=owner='{id}' && session_id='{sid}'`; if hash unchanged skip; else PATCH (scan fields only) or CREATE. Never writes `favorite/hidden/custom_name`.

**Port note:** new code; uses `PbClient` (Task 5).

- [ ] **Step 1: Test** `content_hash_changes_with_message_count()` (pure fn): two sessions differing only in `message_count` → different hashes; identical → same hash.
- [ ] **Step 2:** FAIL → implement `content_hash` + `sync_to_pb`.
- [ ] **Step 3:** `cargo test sync::` → PASS.
- [ ] **Step 4:** In `lib.rs` setup, after `bootstrap`: build `PbClient`, run `scanner::scan_all(&reg)`, `SessionIndex::rebuild`, then `sync_to_pb`. Mount watcher to re-sync on change (debounced).
- [ ] **Step 5:** Run `pnpm tauri dev`; in PB Admin (or via a temporary log) confirm `sessions_meta` rows appear.
- [ ] **Step 6: Commit** `feat(sync): incremental session metadata upsert to PocketBase`.

---

## Task 16: Domain command modules

**Files:** Create `src-tauri/src/commands/{sessions.rs, terminal.rs, config.rs, workbench.rs}`; modify `commands/mod.rs`, `lib.rs` (state holds `ProviderRegistry` + `SessionIndex` + `PbClient`).

**Interfaces (MVP subset — Tauri commands):**
- `sessions_list() -> Vec<Session>` (from a cached in-memory scan, refreshed by watcher)
- `sessions_search(query: String) -> Vec<SessionHit>` (Tantivy backend)
- `sessions_timeline(provider: String, session_id: String) -> Vec<TimelineMessage>`
- `sessions_project_paths() -> Vec<String>`
- `terminal_resume(provider: String, project_path: String, session_id: String, as_tab: bool) -> Result<(), String>`
- `config_get_hotkey() -> String`, `config_set_hotkey(hotkey: String) -> Result<(), String>`
- `workbench_toggle_favorite(session_id: String, on: bool)` etc. → these call PB via `PbClient` (or are done frontend-side via `lib/pb`; **MVP decision: favorites/notes are written frontend-side through `lib/pb/collections.ts`**, so `workbench.rs` only needs read-through helpers if any). Keep `workbench.rs` minimal.

- [ ] **Step 1:** Implement `AppState` holding `reg: ProviderRegistry`, `index: Mutex<SessionIndex>`, `sessions: Mutex<Vec<Session>>`, `pb: Mutex<Option<PbClient>>`, `paths: AppPaths`.
- [ ] **Step 2:** Implement the commands above (thin wrappers over Tasks 9–15). `sessions_list` returns cached `sessions`; `sessions_search` calls `session_backend::search`; `terminal_resume` = `provider.resume_command` → `build_plan` → `execute`.
- [ ] **Step 3:** Register all in `lib.rs` `generate_handler!` grouped by module.
- [ ] **Step 4: Test** one pure-ish command path where feasible (e.g., a unit test for a helper that maps `Session`→list DTO). Otherwise a compile+smoke check.
- [ ] **Step 5:** Run `cargo build` → OK; `pnpm tauri dev` → no panic.
- [ ] **Step 6: Commit** `feat(commands): sessions/terminal/config domain command modules`.

---

## Task 17: Frontend stores (sessions, session-meta, search, restore, spotlight, settings)

**Files:** Create `src/store/{sessions,session-meta,session-search,restore,spotlight,settings}.ts`; extend `src/lib/tauri/ipc.ts`.

**Interfaces:**
- Extend `ipc` with: `listSessions()`, `searchSessions(q)`, `sessionTimeline(provider, id)`, `projectPaths()`, `restore(provider, projectPath, id, asTab)`, `getHotkey()`, `setHotkey(h)`.
- Stores (Zustand), each with `loading/error` + actions:
  - `useSessionsStore`: `{ sessions, groups, viewMode, load() }` — `groups` = sessions grouped by `project_path`.
  - `useSessionMetaStore`: `{ favorites:Set, notes:Map, load(), toggleFavorite(id), setNote(id, text) }` — reads/writes PB via `lib/pb/collections.ts` (COL.sessionsMeta / sessionNotes).
  - `useSessionSearchStore`: `{ query, results, history, run(q) }` — MVP: filter `useSessionsStore.sessions` client-side.
  - `useRestoreStore`: `{ restore(session, asTab) }` → `ipc.restore(...)`.
  - `useSpotlightStore`: `{ query, selectedIndex, items, setQuery, move(dir), setItems }`.
  - `useSettingsStore`: `{ hotkey, workspacePath, load(), saveHotkey(h) }`.

- [ ] **Step 1:** Add the `ipc` methods (each = one `invoke("sessions_list")` etc.).
- [ ] **Step 2:** Implement stores. `useSessionsStore.load()` = `ipc.listSessions()` then compute `groups`.
- [ ] **Step 3: Test** (Vitest — `pnpm add -D vitest`) grouping helper `groupByProject(sessions)` returns a map keyed by project_path. Add `pnpm test` script.
- [ ] **Step 4:** `pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat(fe): session/meta/search/restore/spotlight/settings stores`.

---

## Task 18: Session hub page (grouped list + card + preview)

**Files:** Create `src/pages/sessions.tsx` (replace placeholder), `src/features/sessions/{SessionListView,SessionCard,SessionPreviewPane}.tsx`.

**Interfaces:** consumes `useSessionsStore`, `useSessionMetaStore`, `useSessionSearchStore`.

- [ ] **Step 1:** `SessionCard` shows project name, provider, last_prompt, message_count, favorite star (calls `toggleFavorite`).
- [ ] **Step 2:** `SessionListView` renders `groups` (project → cards); a search box bound to `useSessionSearchStore` filters.
- [ ] **Step 3:** `SessionPreviewPane` (right split): on select, `ipc.sessionTimeline` shows last few messages.
- [ ] **Step 4:** `sessions.tsx` composes list + preview; `useEffect(load)` on mount.
- [ ] **Step 5:** Run `pnpm tauri dev` → real local sessions appear grouped, searchable, previewable, star toggles + persists (reload shows starred).
- [ ] **Step 6: Commit** `feat(fe): session hub — grouped list, card, preview`.

---

## Task 19: Restore dialog + flow

**Files:** Create `src/features/sessions/RestoreDialog.tsx`; wire into `SessionCard`/preview.

- [ ] **Step 1:** `RestoreDialog` with two actions: "恢复到新终端窗" / "作为标签页", calling `useRestoreStore.restore(session, asTab)`.
- [ ] **Step 2:** Wire a "恢复" button on `SessionCard` + `Enter` in preview.
- [ ] **Step 3:** Run app → select a real session → 恢复 → a terminal opens running the correct `claude --resume`/`codex resume` in the right cwd.
- [ ] **Step 4: Commit** `feat(fe): restore dialog + terminal resume flow`.

---

## Task 20: Spotlight window (multiwindow + global hotkey + keyboard nav)

**Files:** Modify `src-tauri/tauri.conf.json` (define `spotlight` window: hidden, decorations:false, alwaysOnTop, center, skipTaskbar); create `src/features/spotlight/{SpotlightApp,SpotlightInput,SpotlightList,useSpotlightKeys}.tsx`; modify `src/App.tsx` (dispatch by window label); add Rust global-shortcut registration in `lib.rs`.

**Interfaces:** `App.tsx` reads `thisWindowLabel()` → renders `<SpotlightApp/>` vs `<AppRouter/>`.

- [ ] **Step 1:** Define `spotlight` window in `tauri.conf.json` (`"visible": false, "decorations": false, "alwaysOnTop": true, "center": true, "skipTaskbar": true, "width": 640, "height": 420`).
- [ ] **Step 2:** Register global shortcut in `lib.rs` setup: on trigger → show+focus spotlight window; add a `spotlight_hide_on_blur` via `on_window_event` (WindowEvent::Focused(false) → hide for label "spotlight").
- [ ] **Step 3:** `App.tsx`: `thisWindowLabel() === "spotlight" ? <SpotlightApp/> : <AppRouter/>` (both inside `ThemeProvider`).
- [ ] **Step 4:** `SpotlightApp`: `<GlassPanel>` (uses `--glass-surface`/`--glass-blur`) + `SpotlightInput` (auto-focus) + `SpotlightList`. `useSpotlightKeys`: ↑/↓ move `selectedIndex`, Enter → `restore` or open in main window, Esc → `hideThisWindow()`, Tab → toggle new-window/tab.
- [ ] **Step 5:** Items = `useSessionsStore.sessions` filtered by `useSpotlightStore.query`; empty query → recent sessions.
- [ ] **Step 6:** Run app → press hotkey → Spotlight appears, type to filter real sessions, ↑↓ select, Enter resumes, blur hides. Verify it works **with main window closed**.
- [ ] **Step 7: Commit** `feat(spotlight): global-hotkey popup window with keyboard nav`.

---

## Task 21: Settings page (hotkey + workspace path)

**Files:** Replace `src/pages/settings.tsx`; ensure `config_get_hotkey`/`config_set_hotkey` persist to `config.toml` (Rust `config.rs`, port from retalk).

- [ ] **Step 1:** Create `src-tauri/src/config.rs` (port retalk config read/write, path via `AppPaths`); `config_set_hotkey` re-registers the global shortcut.
- [ ] **Step 2:** `settings.tsx`: hotkey capture input (bound to `useSettingsStore`), workspace path field.
- [ ] **Step 3:** Run app → change hotkey → new hotkey summons Spotlight after save; persists across restart.
- [ ] **Step 4: Commit** `feat(settings): global hotkey config + workspace path`.

---

## Task 22: MVP integration verification

**Files:** Create `docs/superpowers/plans/mvp-acceptance-checklist.md`.

- [ ] **Step 1:** Manually run the full acceptance checklist from the spec §B.2:
  1. Hotkey → Spotlight → filter real sessions → Enter resumes; blur hides. ☐
  2. Main window session hub: grouped, searchable, previewable, resumable. ☐
  3. Favorite/note persists across restart (in PB, owner-scoped). ☐
  4. Light + dark both neutral, no hardcoded colors, Spotlight glass ok in both. ☐
  5. Resume works with main window closed (multiwindow ok). ☐
  6. `cargo test` passes (core pure functions covered). ☐
- [ ] **Step 2:** Run `cd src-tauri && cargo test` and `pnpm test` → record results in the checklist file.
- [ ] **Step 3:** Fix any failures (loop with systematic-debugging if needed).
- [ ] **Step 4: Commit** `test: MVP acceptance checklist + verification results`.

---

## Self-Review notes (author)

- **Spec coverage:** Phase 0 (§B.1) → Tasks 1–7. Phase ① (§B.2) session hub → Tasks 8–19; Spotlight → Task 20; settings → Task 21; provider trait refactor / no-match → Task 9; search federation deferred (MVP uses client-side filter, Task 17 — matches spec §B.2 "前端过滤"); PB sync → Task 15; tests → embedded per task + Task 22.
- **Out of scope confirmed absent:** no AI chat, Docs/Board/Calendar, ecosystem panel, usage charts, timeline view, federated Rust search, distill/RAG — all correctly deferred per spec §B.3.
- **Type consistency:** `SessionProvider` methods used identically in Tasks 10–14/16; `LaunchPlan`/`ResumeRequest` defined Task 14 used in Task 16/19; `ipc` methods defined Task 6/17 used in Tasks 18–21; `SessionHit` defined Task 13 used in Task 16/17.
- **Known verification points (flagged in-task, not placeholders):** PB 0.30 JSVM `Field`/`Collection` API shape (Task 5 Step 1) and first-superuser subcommand (Task 5 note) must be confirmed against the pinned binary at implementation time.
