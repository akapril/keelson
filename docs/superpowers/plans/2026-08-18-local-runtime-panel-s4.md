# 本地运行时面板（S4）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/processes` 进程页升格为「运行时」——顶部一张"本地运行时"卡展示机器 CPU/内存、agent 容量（在跑/上限）、健康+运行时长、磁盘占用，下方保留托管进程列表。

**Architecture:** 新增 Tauri 命令 `runtime_status` 聚合全部指标（机器资源与磁盘走 `spawn_blocking`；agent 在跑数查 PB；agent 上限用 S2 的 `AGENT_CONCURRENCY_GLOBAL_CAP`；uptime 用 `AppState.started_at`）。前端 `RuntimeStatusCard` 每 3s 轮询它。页与侧栏正名「运行时」，路由保留 `/processes`。

**Tech Stack:** Rust/Tauri v2、sysinfo 0.38（机器 CPU/内存）、tokio spawn_blocking、PocketBase（`PbClient` 查 agent_runs）、React 19 + TS、vitest。

设计依据：`docs/superpowers/specs/2026-08-18-local-runtime-panel-s4-design.md`（已过审）。

## Global Constraints

- **复用 runtime 内核不重写**：`runtime::sysmon`（全局 `sys()`）、`runtime::store`（`load_processes`/`runtime_dir`）、`runtime::resources::format_bytes`、`WorkspaceProcesses`、S2 `AGENT_CONCURRENCY_GLOBAL_CAP` 全复用。
- **重活命令 async + spawn_blocking**：CPU 两次采样含 ~200ms 睡眠、磁盘递归扫描，必须在 `tokio::task::spawn_blocking` 里跑，绝不阻塞主线程（参照 [[rework-tauri-sync-command-blocks-ui]]）。
- **CPU 采样不持锁睡眠**：`system_usage` 先锁→refresh→解锁→睡→再锁→refresh+读，避免 200ms 内阻塞其它 sysmon 调用方（进程列表轮询）。
- **磁盘 MVP 只算 `pb_data + runtime_dir`**（不含各项目 worktrees——分散慢，YAGNI）。不跟随符号链接。
- **路由保留 `/processes`**（不破深链）；只改页标题 + 侧栏标签 + i18n。
- **agent 明细不单列**（归 Inbox）；运行时卡只显在跑计数。
- **轮询间隔 3s 用常量**；不硬编码。轮询失败静默（显 "—" 占位，不 toast）。
- **中文注释**；**TDD**：前端纯函数（formatUptime/capacityLabel/memBarPercent）先写失败测试。Rust 集成靠 `cargo check` + CI；**Windows 本地 `cargo test` 0xc0000139，只验编译**。
- **tsc 通过**；**提交不加 `Co-Authored-By` 尾注**；**git add 精确文件，严禁 `-A`**（工作区有未跟踪 spec/plan + 私有 `docs/promotion/`）。

---

## File Structure

- `src-tauri/src/runtime/sysmon.rs`（改）：加 `system_usage()`。
- `src-tauri/src/runtime/disk.rs`（新）：`dir_size()`。
- `src-tauri/src/runtime/mod.rs`（改）：`pub mod disk;`。
- `src-tauri/src/runtime/resources.rs`（改）：`format_bytes` 提为 `pub(crate)`。
- `src-tauri/src/lib.rs`（改）：`AppState` 加 `started_at: Instant` + Default 初始化；`generate_handler!` 注册 `runtime_status`。
- `src-tauri/src/commands/runtime.rs`（改）：`RuntimeStatus` 结构 + `runtime_status` 命令。
- `src/types/runtime.ts`（改）：`RuntimeStatus` 接口。
- `src/lib/tauri/ipc.ts`（改）：`runtimeStatus()`。
- `src/features/runtime/runtime-format.ts`（新）+ `runtime-format.test.ts`（新）：纯函数。
- `src/features/runtime/RuntimeStatusCard.tsx`（新）：卡组件。
- `src/pages/processes.tsx`（改）：正名 + 挂卡。
- `src/lib/navigation.ts`（改）：进程项改「运行时」。
- `src/i18n/locales/{zh,en}/shell.json`（改）：nav.runtime.* + runtime.* + 卡文案。

---

## Task 1: Rust —— system_usage + disk.dir_size

**Files:**
- Modify: `src-tauri/src/runtime/sysmon.rs`（加 `system_usage`）
- Create: `src-tauri/src/runtime/disk.rs`
- Modify: `src-tauri/src/runtime/mod.rs`（+`pub mod disk;`）

**Interfaces:**
- Produces:
  - `pub fn system_usage() -> (f32, u64, u64)`（cpu_percent, mem_used_bytes, mem_total_bytes）
  - `pub fn dir_size(path: &std::path::Path) -> u64`（递归字节数，不跟随符号链接，失败/不可读计 0）

- [ ] **Step 1: sysmon 加 system_usage**

在 `src-tauri/src/runtime/sysmon.rs` 末尾（`sys()` 已存在，复用）加：

```rust
/// 机器级 CPU% 与内存（used/total 字节）。
/// CPU% 需两次 refresh 差值：先刷一次→不持锁睡最小采样间隔→再刷并读，
/// 避免持锁跨睡眠阻塞其它 sysmon 调用方（进程轮询）。
/// 应在 spawn_blocking 里调用（含 ~200ms 睡眠）。
pub fn system_usage() -> (f32, u64, u64) {
    // 第一次 CPU 采样（锁内刷完即释放）
    {
        let mut s = sys().lock();
        s.refresh_cpu_all();
    }
    // 不持锁睡最小采样间隔（sysinfo 语义：CPU% 靠两次采样差值）
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    let mut s = sys().lock();
    s.refresh_cpu_all();
    s.refresh_memory();
    let cpu = s.global_cpu_usage();
    let used = s.used_memory();
    let total = s.total_memory();
    (cpu, used, total)
}
```

- [ ] **Step 2: 建 disk.rs**

在 `src-tauri/src/runtime/mod.rs` 加 `pub mod disk;`。创建 `src-tauri/src/runtime/disk.rs`：

```rust
//! 目录占用统计：递归求字节数（供运行时磁盘占用展示）。不跟随符号链接。
use std::path::Path;

/// 递归求目录字节数。不可读的项跳过；不跟随符号链接（防循环）；路径不存在返回 0。
pub fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let entries = match std::fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    for entry in entries.flatten() {
        // symlink_metadata 不跟随符号链接，避免符号链接指向大目录/成环
        let meta = match entry.symlink_metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            continue; // 跳过符号链接
        }
        if meta.is_dir() {
            total = total.saturating_add(dir_size(&entry.path()));
        } else if meta.is_file() {
            total = total.saturating_add(meta.len());
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nonexistent_path_is_zero() {
        assert_eq!(dir_size(Path::new("/keelson_no_such_dir_xyz_123")), 0);
    }

    #[test]
    fn sums_file_sizes() {
        // 建临时目录写两个文件，验证求和
        let dir = std::env::temp_dir().join(format!("keelson_disk_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), vec![0u8; 100]).unwrap();
        std::fs::write(dir.join("b.txt"), vec![0u8; 50]).unwrap();
        let sz = dir_size(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(sz, 150);
    }
}
```

- [ ] **Step 3: 编译验证**

Run: `cd src-tauri && cargo check`
Expected: 编译通过（`system_usage`/`dir_size` 暂未被调用会有 dead_code 警告，Task 2 消除）。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/runtime/sysmon.rs src-tauri/src/runtime/disk.rs src-tauri/src/runtime/mod.rs
git commit -m "feat(runtime): system_usage(机器CPU/内存) + disk.dir_size(S4)"
```

---

## Task 2: Rust —— AppState.started_at + runtime_status 命令

**Files:**
- Modify: `src-tauri/src/runtime/resources.rs`（`format_bytes` → `pub(crate)`）
- Modify: `src-tauri/src/lib.rs`（`AppState.started_at` + Default + 注册命令）
- Modify: `src-tauri/src/commands/runtime.rs`（`RuntimeStatus` + `runtime_status`）

**Interfaces:**
- Consumes: `runtime::sysmon::system_usage`、`runtime::disk::dir_size`、`runtime::resources::format_bytes`、`runtime::store::{load_processes, runtime_dir}`、`agent::worker::AGENT_CONCURRENCY_GLOBAL_CAP`、`pb::client::PbClient`、`AppState.auth`/`AppState.paths`/`AppState.started_at`。
- Produces:
  - `AppState.started_at: std::time::Instant`
  - `RuntimeStatus`（serde Serialize，字段见下）+ `#[tauri::command] runtime_status`

- [ ] **Step 1: format_bytes 提 pub(crate)**

`src-tauri/src/runtime/resources.rs:37`：`fn format_bytes` → `pub(crate) fn format_bytes`。

- [ ] **Step 2: AppState 加 started_at**

`src-tauri/src/lib.rs`：
- `pub struct AppState { ... }` 末尾加字段：
  ```rust
      /// 应用启动时刻，供「运行时」页计算 uptime。
      pub started_at: std::time::Instant,
  ```
- `impl Default for AppState { fn default() -> Self { ... Self { ... } } }` 里加 `started_at: std::time::Instant::now(),`（放到构造 `Self { }` 的字段列表中）。

- [ ] **Step 3: runtime_status 命令**

在 `src-tauri/src/commands/runtime.rs` 加（`use crate::AppState;` / `use tauri::State;` / `use crate::pb::client::PbClient;` 按需补）：

```rust
/// 「本地运行时」聚合状态：机器资源 + agent 容量 + 健康/时长 + 磁盘。
#[derive(serde::Serialize)]
pub struct RuntimeStatus {
    pub cpu_percent: f32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub mem_display: String,   // "5.2 GB / 16 GB"
    pub agent_running: u32,
    pub agent_cap: u32,
    pub uptime_secs: u64,
    pub disk_bytes: u64,
    pub disk_display: String,  // "1.3 GB"
    pub pb_ok: bool,
    pub proc_count: u32,
}

#[tauri::command]
pub async fn runtime_status(
    state: State<'_, AppState>,
) -> Result<RuntimeStatus, String> {
    // 1) 阻塞部分（CPU 两次采样含睡眠 + 磁盘递归）走 spawn_blocking，不冻 UI
    let pb_data = state.paths.app_data.join("pb_data");
    let rt_dir = crate::runtime::store::runtime_dir();
    let (cpu_percent, mem_used, mem_total, disk_bytes) =
        tokio::task::spawn_blocking(move || {
            let (cpu, used, total) = crate::runtime::sysmon::system_usage();
            let disk = crate::runtime::disk::dir_size(&pb_data)
                .saturating_add(crate::runtime::disk::dir_size(&rt_dir));
            (cpu, used, total, disk)
        })
        .await
        .map_err(|e| e.to_string())?;

    // 2) agent 在跑数（查 PB agent_runs status=running）——auth 未就绪则计 0
    let (agent_running, pb_ok) = {
        let auth = {
            let g = state.auth.lock();
            g.as_ref().map(|a| (a.base_url.clone(), a.token.clone()))
        };
        match auth {
            Some((base, token)) => {
                let client = PbClient::new(&base, &token);
                match client
                    .list("agent_runs", "status = \"running\" && deleted_at = \"\"", "id")
                    .await
                {
                    Ok(rows) => (rows.len() as u32, true),
                    Err(_) => (0, false),
                }
            }
            None => (0, false),
        }
    };

    // 3) 托管进程数（status=running）
    let proc_count = crate::runtime::store::load_processes()
        .iter()
        .filter(|e| e.status == "running")
        .count() as u32;

    let uptime_secs = state.started_at.elapsed().as_secs();
    let mem_display = format!(
        "{} / {}",
        crate::runtime::resources::format_bytes(mem_used),
        crate::runtime::resources::format_bytes(mem_total),
    );
    let disk_display = crate::runtime::resources::format_bytes(disk_bytes);

    Ok(RuntimeStatus {
        cpu_percent,
        mem_used,
        mem_total,
        mem_display,
        agent_running,
        agent_cap: crate::agent::worker::AGENT_CONCURRENCY_GLOBAL_CAP as u32,
        uptime_secs,
        disk_bytes,
        disk_display,
        pb_ok,
        proc_count,
    })
}
```

- [ ] **Step 4: 注册命令**

`src-tauri/src/lib.rs` 的 `tauri::generate_handler![...]` 里加一行 `commands::runtime::runtime_status,`（放在其它 runtime 命令附近）。

- [ ] **Step 5: 编译验证**

Run: `cd src-tauri && cargo check`
Expected: 编译通过；Task 1 的 dead_code 警告消失。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/runtime/resources.rs src-tauri/src/lib.rs src-tauri/src/commands/runtime.rs
git commit -m "feat(runtime): runtime_status 聚合命令 + AppState.started_at(S4)"
```

---

## Task 3: 前端 —— 类型 + ipc + runtime-format 纯函数

**Files:**
- Modify: `src/types/runtime.ts`（+`RuntimeStatus`）
- Modify: `src/lib/tauri/ipc.ts`（+`runtimeStatus`）
- Create: `src/features/runtime/runtime-format.ts`
- Test: `src/features/runtime/runtime-format.test.ts`

**Interfaces:**
- Produces:
  - `RuntimeStatus` 接口（对齐 Rust 字段）。
  - `runtimeStatus(): Promise<RuntimeStatus>`。
  - `formatUptime(secs)`、`capacityLabel(running, cap)`、`memBarPercent(used, total)`。

- [ ] **Step 1: 写纯函数失败测试**

创建 `src/features/runtime/runtime-format.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { formatUptime, capacityLabel, memBarPercent } from "./runtime-format";

describe("formatUptime", () => {
  it("秒级", () => expect(formatUptime(45)).toBe("45s"));
  it("分级", () => expect(formatUptime(125)).toBe("2m"));
  it("时分", () => expect(formatUptime(3 * 3600 + 12 * 60)).toBe("3h 12m"));
});

describe("capacityLabel", () => {
  it("在跑/上限", () => expect(capacityLabel(3, 8)).toBe("3 / 8"));
});

describe("memBarPercent", () => {
  it("比例取整", () => expect(memBarPercent(50, 100)).toBe(50));
  it("total 0 → 0", () => expect(memBarPercent(5, 0)).toBe(0));
  it("上限 100", () => expect(memBarPercent(150, 100)).toBe(100));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/features/runtime/runtime-format.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 runtime-format.ts**

```ts
// 运行时卡纯函数（可测）：uptime 文案 / 容量文案 / 内存条百分比。
/** 秒 → 人类可读运行时长（<60s 显秒；<1h 显分；否则时+分）。 */
export function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor(secs / 60) % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** agent 容量文案："在跑 / 上限"。 */
export function capacityLabel(running: number, cap: number): string {
  return `${running} / ${cap}`;
}

/** 内存条百分比（0-100 取整；total<=0 返回 0）。 */
export function memBarPercent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}
```

- [ ] **Step 4: 类型 + ipc**

`src/types/runtime.ts` 加（与既有 `RuntimeProcess`/`RuntimeLog` 并列）：

```ts
/** 「本地运行时」聚合状态（对齐 Rust RuntimeStatus）。 */
export interface RuntimeStatus {
  cpu_percent: number;
  mem_used: number;
  mem_total: number;
  mem_display: string;
  agent_running: number;
  agent_cap: number;
  uptime_secs: number;
  disk_bytes: number;
  disk_display: string;
  pb_ok: boolean;
  proc_count: number;
}
```

`src/lib/tauri/ipc.ts` 加（在 runtime 相关 ipc 附近，import `RuntimeStatus`）：

```ts
  /** 拉取本地运行时聚合状态（运行时卡轮询）。 */
  runtimeStatus: () => call<RuntimeStatus>("runtime_status"),
```

- [ ] **Step 5: 测试 + tsc**

Run: `pnpm vitest run src/features/runtime/runtime-format.test.ts && pnpm tsc --noEmit`
Expected: PASS + tsc 净。

- [ ] **Step 6: 提交**

```bash
git add src/types/runtime.ts src/lib/tauri/ipc.ts src/features/runtime/runtime-format.ts src/features/runtime/runtime-format.test.ts
git commit -m "feat(runtime): RuntimeStatus 类型/ipc + runtime-format 纯函数(S4)"
```

---

## Task 4: RuntimeStatusCard 组件

**Files:**
- Create: `src/features/runtime/RuntimeStatusCard.tsx`

**Interfaces:**
- Consumes: `ipc.runtimeStatus`、`RuntimeStatus`、`formatUptime`/`capacityLabel`/`memBarPercent`、`useTranslation`、`cn`。
- Produces: `<RuntimeStatusCard/>`（自轮询）。

- [ ] **Step 1: 实现组件**

创建 `src/features/runtime/RuntimeStatusCard.tsx`：

```tsx
// 「本地运行时」状态卡：健康/时长 · 机器资源(CPU/内存) · agent 容量 · 磁盘。
// 每 3s 轮询 ipc.runtimeStatus；轮询失败静默（显 "—" 占位，不 toast 轰炸）。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/tauri/ipc";
import type { RuntimeStatus } from "@/types/runtime";
import { formatUptime, capacityLabel, memBarPercent } from "./runtime-format";
import { cn } from "@/lib/utils";

// 轮询间隔（CPU 是活值，需要定期刷新）
const POLL_MS = 3000;

export function RuntimeStatusCard() {
  const { t } = useTranslation("shell");
  const [status, setStatus] = useState<RuntimeStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () => {
      ipc
        .runtimeStatus()
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {
          /* 轮询失败静默：保留上次值/占位，不打断用户 */
        });
    };
    fetchOnce();
    const timer = setInterval(fetchOnce, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // 占位符：数据未到时显 "—"
  const dash = "—";
  const capFull = !!status && status.agent_running >= status.agent_cap;

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:grid-cols-4">
      {/* 健康 / 运行时长 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("runtime.card.health")}</span>
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className={cn("size-2 rounded-full", status?.pb_ok ? "bg-emerald-500" : "bg-amber-500")} />
          {t("runtime.card.running")}
        </span>
        <span className="text-xs text-muted-foreground">
          {status ? formatUptime(status.uptime_secs) : dash}
        </span>
      </div>

      {/* 机器资源 CPU / 内存 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("runtime.card.resources")}</span>
        <span className="text-sm font-medium">
          CPU {status ? `${Math.round(status.cpu_percent)}%` : dash}
        </span>
        <div className="mt-0.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${status ? memBarPercent(status.mem_used, status.mem_total) : 0}%` }}
            />
          </div>
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            {status ? status.mem_display : dash}
          </span>
        </div>
      </div>

      {/* agent 容量 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("runtime.card.agentCapacity")}</span>
        <span className={cn("text-sm font-medium", capFull && "text-destructive")}>
          {status ? capacityLabel(status.agent_running, status.agent_cap) : dash}
        </span>
        {capFull && (
          <span className="text-[10px] text-destructive">{t("runtime.card.capFull")}</span>
        )}
      </div>

      {/* 磁盘占用 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("runtime.card.disk")}</span>
        <span className="text-sm font-medium">{status ? status.disk_display : dash}</span>
        <span className="text-[10px] text-muted-foreground">{t("runtime.card.diskHint")}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc（i18n 键在 Task 5 补，暂用键名占位不影响 tsc）**

Run: `pnpm tsc --noEmit`
Expected: 无错（`t("runtime.card.*")` 键此刻未定义，运行时会显键名，但 tsc 不校验 i18n 键存在——Task 5 补齐）。

- [ ] **Step 3: 提交**

```bash
git add src/features/runtime/RuntimeStatusCard.tsx
git commit -m "feat(runtime): RuntimeStatusCard 卡组件(四区+3s轮询)(S4)"
```

---

## Task 5: /processes 页正名「运行时」+ 挂卡 + 侧栏 + i18n

**Files:**
- Modify: `src/pages/processes.tsx`
- Modify: `src/lib/navigation.ts`
- Modify: `src/i18n/locales/zh/shell.json`
- Modify: `src/i18n/locales/en/shell.json`

**Interfaces:**
- Consumes: `RuntimeStatusCard`、`WorkspaceProcesses`。

- [ ] **Step 1: processes 页正名 + 挂卡**

`src/pages/processes.tsx`：
- import `RuntimeStatusCard`（`@/features/runtime/RuntimeStatusCard`）。
- 页标题 `t("processes.title")` → `t("runtime.title")`；副标题 `processes.description` → `runtime.description`。
- 在标题块之后、`<WorkspaceProcesses/>` 之前渲染 `<RuntimeStatusCard/>`。
- `<WorkspaceProcesses/>` 上方加一个区块小标题 `t("runtime.managedProcesses")`（"托管进程"），使层级清晰。

改后大致：

```tsx
import { useTranslation } from "react-i18next";
import { WorkspaceProcesses } from "@/features/board/WorkspaceProcesses";
import { RuntimeStatusCard } from "@/features/runtime/RuntimeStatusCard";

export default function ProcessesPage() {
  const { t } = useTranslation("shell");
  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      <div className="mb-3 shrink-0">
        <h1 className="text-lg font-semibold">{t("runtime.title")}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("runtime.description")}</p>
      </div>
      <RuntimeStatusCard />
      <div className="mb-2 shrink-0">
        <h2 className="text-sm font-medium text-muted-foreground">{t("runtime.managedProcesses")}</h2>
      </div>
      <div className="min-h-0 flex-1">
        <WorkspaceProcesses />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 侧栏正名**

`src/lib/navigation.ts`：System 组「进程」项（`nav.processes.title`/`nav.processes.description` → `/processes`，icon `TerminalIcon`）：
- `titleKey` → `"nav.runtime.title"`，`descriptionKey` → `"nav.runtime.description"`，`url` 保持 `/processes`。
- 图标可保留 `TerminalIcon`，或换更贴切的（如 `Cpu`——**实现时确认 `@hugeicons/core-free-icons` 里图标名存在**，`pnpm tsc --noEmit` 会对未导出名报错；不确定就保留 `TerminalIcon`）。

- [ ] **Step 3: i18n（zh + en，shell ns）**

`src/i18n/locales/zh/shell.json` 加/改：
- `nav.runtime.title` = "运行时"、`nav.runtime.description` = "本地运行时与托管进程"。
- `runtime.title` = "运行时"、`runtime.description` = "本地机器资源、agent 容量与托管进程"、`runtime.managedProcesses` = "托管进程"。
- `runtime.card.health` = "状态"、`runtime.card.running` = "运行中"、`runtime.card.resources` = "机器资源"、`runtime.card.agentCapacity` = "Agent 容量"、`runtime.card.capFull` = "已达上限，新指派将排队"、`runtime.card.disk` = "磁盘占用"、`runtime.card.diskHint` = "运行时数据"。
（保留原 `nav.processes.*`/`processes.*` 键不删，避免别处引用报错；新键并存。）

`src/i18n/locales/en/shell.json` 加对应英文：runtime/Runtime、Local machine resources, agent capacity & managed processes、Managed processes、Status、Running、Resources、Agent capacity、"At capacity — new assignments will queue"、Disk usage、Runtime data。

- [ ] **Step 4: tsc + json + i18n 测试**

Run: `pnpm tsc --noEmit`
Expected: 无错。
`node -e "['zh','en'].forEach(l=>require('./src/i18n/locales/'+l+'/shell.json'));console.log('json ok')"`。
若有 shell i18n 测试：`pnpm vitest run src/i18n/__tests__/` 相关项过。

- [ ] **Step 5: 提交**

```bash
git add src/pages/processes.tsx src/lib/navigation.ts src/i18n/locales/zh/shell.json src/i18n/locales/en/shell.json
git commit -m "feat(runtime): /processes 正名运行时 + 挂卡 + 侧栏/i18n(S4)"
```

---

## Self-Review

**1. Spec coverage：**
- §A1 机器资源 → Task 1（system_usage）。§A2 磁盘 → Task 1（dir_size）+ Task 2（聚合，只算 pb_data+runtime_dir）。§A3 uptime → Task 2（started_at）。§A4 agent 容量+健康 → Task 2（agent_running/agent_cap/pb_ok/proc_count）。§A5 聚合命令 → Task 2。✅
- §B1 卡 → Task 4。§B2 页正名 → Task 5。§B3 侧栏 → Task 5。§B4 类型/ipc → Task 3。§B5 i18n → Task 5。✅
- §C「明确不做」（多运行时/agent 明细/worktrees 磁盘/曲线/清理/进程功能改动/侧栏重排）→ 无任务涉及。✅

**2. Placeholder scan：** 无 TBD/TODO。纯函数（system_usage/dir_size/formatUptime/capacityLabel/memBarPercent）与命令/组件均给完整代码。Task 5 Step 2 图标名"实现时确认"附确切校验方式（tsc 报未导出名）+ 兜底（保留 TerminalIcon），非占位。

**3. Type consistency：**
- `RuntimeStatus` 字段 Rust（Task 2）↔ TS（Task 3）逐字对齐（cpu_percent/mem_used/mem_total/mem_display/agent_running/agent_cap/uptime_secs/disk_bytes/disk_display/pb_ok/proc_count）。✅
- `system_usage()->(f32,u64,u64)` Task 1 定义、Task 2 消费一致。`dir_size(&Path)->u64` 同。✅
- `runtimeStatus(): Promise<RuntimeStatus>` Task 3 定义、Task 4 消费。✅
- `formatUptime/capacityLabel/memBarPercent` Task 3 定义、Task 4 消费一致。✅
- `AGENT_CONCURRENCY_GLOBAL_CAP`(usize) → `agent_cap`(u32) 有 `as u32` 转换。✅
- `format_bytes` 提 pub(crate)（Task 2 Step 1）供命令用。✅

**4. 约束落实：** 每 Task `git add` 确切文件无 `-A`；提交无 Co-Authored-By；重活 spawn_blocking（Task 2）；CPU 采样不持锁睡眠（Task 1）；磁盘只算 pb_data+runtime_dir；路由保留 /processes；轮询 3s 常量 + 失败静默（Task 4）；Rust 测试策略 cargo check + CI；前端 TDD 纯函数先测（Task 3）。✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-18-local-runtime-panel-s4.md`. 两种执行方式：

**1. Subagent-Driven（推荐）** —— 每 Task 派新 subagent + Task 间双阶段审查 + 末尾全分支审查。

**2. Inline Execution** —— 本会话内批量执行，带检查点。

选哪个？
