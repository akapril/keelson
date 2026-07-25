# rework 审计修复实现计划（A/B/C/D 四组）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2026-07-24 全项目审计发现的崩溃/数据丢失、安全、性能、架构债四类问题（已逐条读码核实，剔除误报）。

**Architecture:** Tauri v2（Rust 后端 + React19/TS 前端 + PocketBase sidecar），内嵌进程管理内核（`runtime/`）与进程内 MCP HTTP 服务（axum :47600）。修复分四个 Phase，按崩溃→安全→性能→债务优先级推进；每个 Task 独立可测、可单独回退。

**Tech Stack:** Rust / tokio / axum / reqwest / serde_json；React 19 / Zustand / Vite / Vitest；PocketBase JS migrations。

## Global Constraints

- 所有新增注释/日志用**中文**；修改必须带中文注释说明意图。
- 中性主题：不硬编码颜色（沿用现有 CSS 变量）。
- PB `text` 字段运行时强制 5000 上限，需长文本必须显式 `max`（0 不是无限，会回落 5000）。
- 前端改动 reload 生效；Rust 改动需 `cargo build` + 重启 rework（构建前先 `Get-Process pocketbase | Stop-Process` 释放 target 锁）。
- 不引入大型新依赖；`subtle`（常量时间比较）为唯一允许的小型安全依赖。
- 每个 Task 结束需通过对应验证命令（`pnpm test` / `cargo test` / `tsc` / `cargo build`）。
- **已核实的误报，不修**：`runtime/process.rs` 的 `ps()/start()/stop()/restart()`（含中文字节切片 `[..27]`/`[..17]`）全项目零调用者，是死代码——按 D2 删除处理，不当作崩溃修复。

---

# Phase A — 崩溃 / 数据丢失（最高优先）

## Task A1: `store.rs` 主进程 `expect()` panic → 优雅降级

**Files:**
- Modify: `src-tauri/src/runtime/store.rs`（`runtime_dir` :55、`stdout_dir` :63、`load_processes` :80、`save_processes` :87-88）

**问题:** `load_processes`/`save_processes`/`runtime_dir` 里 6 处 `expect()` 跑在 Tauri 主进程，磁盘满/权限异常直接 panic 崩整个 app，且这些是每次 ps/start/stop/health 都调的高频路径。

**Interfaces:**
- Produces: `load_processes() -> Vec<ProcessEntry>`（签名不变，失败返回空 Vec）；`save_processes(&[ProcessEntry])`（签名不变，失败写 `eprintln!` 不 panic）；`runtime_dir()`/`stdout_dir()` 签名不变（失败回退到临时目录而非 panic）。

- [ ] **Step 1: 改 `runtime_dir`/`stdout_dir` 去 expect**

```rust
/// 获取 runtime 数据目录 (~/.claude-runtime/)。
/// 失败（无 home / 无法建目录）时回退系统临时目录，绝不 panic（跑在主进程）。
pub fn runtime_dir() -> PathBuf {
    let base = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join(".claude-runtime");
    // 建目录失败不致命：后续读写各自处理错误
    let _ = fs::create_dir_all(&dir);
    dir
}

/// 获取 stdout 日志目录。建目录失败不 panic。
pub fn stdout_dir() -> PathBuf {
    let dir = runtime_dir().join("stdout");
    let _ = fs::create_dir_all(&dir);
    dir
}
```

- [ ] **Step 2: 改 `load_processes` 去 expect（读失败=空表）**

```rust
/// 读取进程表。读失败或解析失败均返回空表（进程表不可读时不该崩 app）。
pub fn load_processes() -> Vec<ProcessEntry> {
    let path = process_table_path();
    if !path.exists() {
        return Vec::new();
    }
    match fs::read_to_string(&path) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(e) => {
            eprintln!("[runtime] 读取进程表失败（返回空表）: {e}");
            Vec::new()
        }
    }
}
```

- [ ] **Step 3: 改 `save_processes` 去 expect（写失败=记日志）**

```rust
/// 写入进程表。序列化/写盘失败时记日志但不 panic；成功后唤醒变更通知。
pub fn save_processes(entries: &[ProcessEntry]) {
    let path = process_table_path();
    let data = match serde_json::to_string_pretty(entries) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[runtime] 序列化进程表失败: {e}");
            return;
        }
    };
    if let Err(e) = fs::write(&path, data) {
        eprintln!("[runtime] 写入进程表失败: {e}");
        return;
    }
    change_notify().notify_waiters();
}
```

- [ ] **Step 4: 编译验证**

Run: `Get-Process pocketbase -ErrorAction SilentlyContinue | Stop-Process -Force; cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 编译通过，无 `expect` 残留（`grep -n "expect(" src-tauri/src/runtime/store.rs` 应为空）。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/runtime/store.rs
git commit -m "fix(runtime): store 读写去 expect，主进程失败不再 panic"
```

---

## Task A2: `processes.json` 并发写加锁

**Files:**
- Modify: `src-tauri/src/runtime/store.rs`（新增全局 `Mutex`，包裹 load+modify+save 临界区）

**问题:** `add_process`/`update_process`/`remove_process` 都是「load→改→save」非原子序列，无锁；健康检查(10s)、看门狗(2s)、端口检测(1s×10) 并发跑同时写 `processes.json`，会互相覆盖 → 进程表损坏或被截断成非法 JSON → 下次 `load` 反序列化失败清零。

**Interfaces:**
- Consumes: `std::sync::Mutex`（std，无新依赖）。
- Produces: `update_process`/`add_process`/`remove_process`/`save_processes` 语义不变，但读改写变为串行临界区。

- [ ] **Step 1: 加全局写锁**

在 `store.rs` 顶部（`change_notify` 附近）新增：

```rust
use std::sync::Mutex;

/// 进程表读-改-写串行锁：防止健康检查/看门狗/端口检测并发写 processes.json 互相覆盖。
/// 锁粒度为「整个 load+modify+save 序列」，进程表极小(几十条)，串行代价可忽略。
fn table_lock() -> &'static Mutex<()> {
    static L: OnceLock<Mutex<()>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(()))
}
```

- [ ] **Step 2: `add_process`/`remove_process`/`update_process` 全序列持锁**

```rust
pub fn add_process(entry: ProcessEntry) {
    let _guard = table_lock().lock().unwrap_or_else(|e| e.into_inner()); // 中毒锁也继续
    let mut entries = load_processes();
    entries.push(entry);
    save_processes(&entries);
}

pub fn remove_process(id: &str) {
    let _guard = table_lock().lock().unwrap_or_else(|e| e.into_inner());
    let mut entries = load_processes();
    entries.retain(|e| e.id != id);
    save_processes(&entries);
}

pub fn update_process<F>(id: &str, updater: F)
where
    F: FnOnce(&mut ProcessEntry),
{
    let _guard = table_lock().lock().unwrap_or_else(|e| e.into_inner());
    let mut entries = load_processes();
    if let Some(entry) = entries.iter_mut().find(|e| e.id == id) {
        updater(entry);
    }
    save_processes(&entries);
}
```

> 注：`save_processes`/`load_processes` 内部**不**再单独取锁（避免重入死锁）；锁只在三个公开修改函数入口取。`find_process`/`load_processes` 只读，读到中间态的概率因写序列变短而大幅降低，可接受。

- [ ] **Step 3: 编译 + 冒烟**

Run: `Get-Process pocketbase -ErrorAction SilentlyContinue | Stop-Process -Force; cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 通过。手动：启动 rework，用 intercept 起 1 个进程，观察 3 个后台定时器并发下 `~/.claude-runtime/processes.json` 始终是合法 JSON（多刷几次「进程」页不报错）。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/runtime/store.rs
git commit -m "fix(runtime): processes.json 读改写加全局锁，消除并发写竞争"
```

---

## Task A3: `docs.content` 补 max（长文档不再静默截断）

**Files:**
- Create: `src-tauri/pb_migrations/1720002200_docs_text_max.js`

**问题:** `1720000200_docs.js:43` 将 `docs.content` 设 `max:0`，PB 回落 5000 上限；`1720002100` 修了 reading/prompts 但漏了 docs → 用户写 >5000 字文档保存时 PB 400，前端乐观更新已落 UI 但持久化失败，数据丢失无感知。

- [ ] **Step 1: 新建迁移（照抄 1720002100 的 setMax 模式）**

```javascript
// 修坑：docs.content 在 1720000200 建表时设 max:0（PB 0.30 回落默认 5000 上限）。
// 1720002100 修了 reading_items/prompts 却漏了 docs.content —— 长文档保存 400、静默丢数据。
// 顺带兜底 sessions_meta.last_prompt / session_notes.content（同 max:0/无 max 隐患）。
migrate((app) => {
  const setMax = (collName, fieldName, max) => {
    try {
      const c = app.findCollectionByNameOrId(collName);
      const f = c.fields.getByName(fieldName);
      if (f) {
        f.max = max;
        app.save(c);
      }
    } catch (_) {
      /* 集合/字段不存在则跳过 */
    }
  };
  // 文档正文可很长 → 256KB
  setMax("docs", "content", 262144);
  // 会话最后 prompt 常粘长代码 → 16KB；备注 → 64KB
  setMax("sessions_meta", "last_prompt", 16384);
  setMax("session_notes", "content", 65536);
}, (app) => {
  const setMax = (collName, fieldName, max) => {
    try {
      const c = app.findCollectionByNameOrId(collName);
      const f = c.fields.getByName(fieldName);
      if (f) {
        f.max = max;
        app.save(c);
      }
    } catch (_) {}
  };
  setMax("docs", "content", 0);
  setMax("sessions_meta", "last_prompt", 0);
  setMax("session_notes", "content", 0);
});
```

> 说明：本 Task 同时覆盖 A5（`last_prompt`/`session_notes.content` 补 max），因为它们共用一支迁移最省事。

- [ ] **Step 2: 验证迁移生效**

Run: 重启 rework（PB sidecar 启动时自动跑新迁移），在设置页「打开数据目录」→ `pb_data`，或用 PB admin 查 `docs.content` 字段 max 已为 262144。手动：新建一篇 >5000 字文档保存，刷新后内容完整。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/pb_migrations/1720002200_docs_text_max.js
git commit -m "fix(pb): docs.content/last_prompt/session_notes 补 text max，防长文本静默截断"
```

---

## Task A4: store 乐观更新吞错 → 统一重抛 + 调用点 toast

**Files:**
- Modify: `src/store/reading.ts`（`updateItem` :132-135、`removeItem` :145-148）
- Modify: `src/store/calendar.ts`（`updateEvent` :143-146、`removeEvent` :156-159）
- Modify: `src/store/notifications.ts`（`markRead`/`markAllRead`/`markManyRead`/`remove`/`removeMany`/`clearAll` 六处 catch）
- Modify: `src/store/session-meta.ts`（`toggleFavorite`/`toggleHidden`/`setNote`/`setCustomName` 四处 catch）
- Modify: `src/store/board.ts`（`moveTask` :431-434）
- Modify: 上述方法的调用点（`ReadingPage.tsx`/`CalendarPage.tsx`/`SessionListView.tsx`/`inbox.tsx`/`KanbanBoard.tsx` 等 `void xxx(...)` 处）

**问题:** 14+ 个乐观更新方法在 catch 里只回滚 `set(...)` **不重抛**，调用方 `await`/`.then` 正常走下去，写 PB 失败却 UI 误报成功、操作"自己撤销"。board 的 `updateTask`/`deleteTask` 已修（重抛）为参考模式，其余全部漏。

**Interfaces:**
- Produces: 所有乐观更新方法在回滚后 `throw e`；调用点用 `.catch((e) => toast.error(...))` 兜底。

- [ ] **Step 1: reading.ts 两处 catch 加 throw**

```typescript
// updateItem catch：
} catch (e) {
  // 回滚并重抛，让调用方能感知失败（不再误报成功）
  set({ items, error: String(e) });
  throw e;
}
// removeItem catch 同样：set({ items, error: String(e) }); throw e;
```

- [ ] **Step 2: calendar.ts 两处 catch 加 throw**（同 Step 1 模式，`updateEvent`/`removeEvent`，回滚 `set({ events, error })` 后 `throw e`）

- [ ] **Step 3: notifications.ts 六处 catch 加 throw**（`markRead`/`markAllRead`/`markManyRead`/`remove`/`removeMany`/`clearAll`，各自 `set({ items: snapshot, error: String(e) })` 后 `throw e`）

- [ ] **Step 4: session-meta.ts 四处 catch 加 throw**（`toggleFavorite`/`toggleHidden`/`setNote`/`setCustomName`，各自回滚 `set(...)` 后 `throw e`）

- [ ] **Step 5: board.ts moveTask catch 加 throw**

```typescript
} catch (e) {
  // 失败则回滚到快照，并重抛（与 updateTask/deleteTask 一致，供调用点 toast）
  set({ tasks: snapshot, error: String(e) });
  throw e;
}
```

- [ ] **Step 6: 调用点补 `.catch(toast)`（防未处理 rejection）**

Run: `grep -rn "void \(updateItem\|removeItem\|updateEvent\|removeEvent\|markRead\|markAllRead\|markManyRead\|removeMany\|clearAll\|toggleFavorite\|toggleHidden\|setNote\|setCustomName\|moveTask\)\b" src/`
对每个未带 `.catch` 的调用点，改为（示例）：
```typescript
void updateItem(id, patch).catch((e) => toast.error(`保存失败：${String(e)}`));
```
（`toast` 从 `sonner` 导入，参考 `TaskCard.tsx:87` 现有用法。KanbanBoard.tsx:322 已有 `.catch(() => {})` 的要改成带 toast。）

- [ ] **Step 7: 验证**

Run: `pnpm test && npx tsc --noEmit`
Expected: 类型通过、测试通过。手动（可选）：断网状态下拖拽任务/编辑阅读条目，应出现红色 toast 而非静默回滚。

- [ ] **Step 8: Commit**

```bash
git add src/store/ src/features/ src/pages/
git commit -m "fix(store): 乐观更新失败统一重抛 + 调用点 toast，消除误报成功"
```

---

# Phase B — 安全（本地桌面威胁模型）

## Task B1: intercept/start 命令 shell 注入防护

**Files:**
- Modify: `src-tauri/src/mcp/intercept.rs`（`handle_intercept` 托管前加 shell 元字符校验）

**问题:** `daemon.rs:130/147` 把 `command` 直拼 `cmd /C`/`sh -c`；intercept 路径的 command 来自 Claude 的 `PreToolUse` hook payload（`tool_input.command`）。`npm run dev; curl evil` 能过 `is_long_running_command` 正则（正向命中 `npm run dev`，负向不含 `;`），注入部分被 shell 执行 → 本机 RCE。前提是拦截 hook 已启用。

**决策依赖:** 若你倾向"托管功能优先、注入风险可接受"，可只加**告警日志**不拦截；本 Task 采用**保守**方案：含 shell 元字符的长驻命令**放行但不托管**（`allow()`），避免把可疑命令喂进 shell。

**Interfaces:**
- Consumes: `is_long_running_command`（已有）。
- Produces: 新增纯函数 `has_shell_metachars(cmd: &str) -> bool`（便于单测）。

- [ ] **Step 1: 写失败测试（含元字符不托管）**

在 `intercept.rs` 的 `#[cfg(test)] mod tests` 加：
```rust
#[test]
fn rejects_shell_metachars() {
    assert!(has_shell_metachars("npm run dev; curl evil"));
    assert!(has_shell_metachars("npm run dev && rm -rf x"));
    assert!(has_shell_metachars("npm run dev | tee x"));
    assert!(has_shell_metachars("vite $(whoami)"));
    assert!(has_shell_metachars("vite `id`"));
    assert!(!has_shell_metachars("npm run dev"));
    assert!(!has_shell_metachars("python main.py --port 8000"));
}
```

- [ ] **Step 2: Run 失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml has_shell_metachars` → FAIL（函数未定义）。

- [ ] **Step 3: 实现 `has_shell_metachars` + 接入 handle_intercept**

```rust
/// 检测命令是否含 shell 注入常用元字符。含则不托管（放行让用户/Claude 自行处理），
/// 避免把不可信命令喂进 cmd /C / sh -c 造成注入。纯函数，便于单测。
pub fn has_shell_metachars(cmd: &str) -> bool {
    // ; && || | 管道/串联；$(...) `...` 命令替换；> < 重定向；& 后台
    const META: &[&str] = &[";", "&&", "||", "|", "$(", "`", ">", "<", "&"];
    META.iter().any(|m| cmd.contains(m))
}
```
在 `handle_intercept` 里，`is_long_running_command(&command)` 判定后、`daemon_start` 之前加：
```rust
// 含 shell 元字符 → 不托管（防注入），放行原命令
if has_shell_metachars(&command) {
    return allow();
}
```

- [ ] **Step 4: Run 通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p rework_lib intercept`（或项目实际测试命令）→ PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mcp/intercept.rs
git commit -m "fix(security): intercept 托管前拦截含 shell 元字符的命令，防注入"
```

---

## Task B2: `read_text_file`/`write_text_file` 路径白名单

**Files:**
- Modify: `src-tauri/src/commands/fs.rs`（`write_text_file` :10、`read_text_file` :78）

**问题:** 两命令可读写文件系统**任意路径**无限制；WebView XSS/供应链注入可 `read_text_file("~/.ssh/id_rsa")` 或 `write_text_file("~/.bashrc", 后门)`。

**决策依赖:** 完全沙箱化会破坏"另存为任意路径"体验。折中：`read_text_file` 限 `.md`（当前唯一用途=导入计划/spec）；`write_text_file` 限"父目录必须已存在"（阻止写系统敏感路径的常见形态）+ 拒绝已知敏感文件名。若你要更严可改白名单目录。

**Interfaces:**
- Produces: 两命令签名不变，非法路径返回 `Err(String)`。

- [ ] **Step 1: `read_text_file` 限扩展名**

```rust
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    // 仅允许读 .md（当前用途：导入计划 / spec）。防任意文件读取。
    let ext = Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());
    if ext.as_deref() != Some("md") {
        return Err("仅支持读取 .md 文件".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {e}"))
}
```

- [ ] **Step 2: `write_text_file` 拒敏感文件名**

```rust
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    // 防写入已知敏感文件（XSS/注入企图持久化后门）
    let fname = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
    const BLOCKED: &[&str] = &[
        ".bashrc", ".zshrc", ".bash_profile", ".profile",
        "id_rsa", "id_ed25519", "authorized_keys", "known_hosts",
        "settings.json", "hosts",
    ];
    if BLOCKED.iter().any(|b| fname.eq_ignore_ascii_case(b)) {
        return Err(format!("拒绝写入敏感文件: {fname}"));
    }
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
    }
    fs::write(p, content).map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(())
}
```

- [ ] **Step 3: 更新/补测试**

在 `fs.rs` tests 加：
```rust
#[test]
fn read_rejects_non_md() {
    assert!(read_text_file("C:/Windows/system32/drivers/etc/hosts".into()).is_err());
}
#[test]
fn write_rejects_sensitive() {
    assert!(write_text_file("Z:/tmp/.bashrc".into(), "x".into()).is_err());
}
```
Run: `cargo test --manifest-path src-tauri/Cargo.toml fs::` → PASS。

- [ ] **Step 4: 回归确认前端用途未破坏**

Run: `grep -rn "readTextFile\|writeTextFile\|read_text_file\|write_text_file" src/`
确认 `read_text_file` 调用点都读 `.md`（导入计划/spec）；`write_text_file` 调用点（导出另存为）文件名非 BLOCKED 列表。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/fs.rs
git commit -m "fix(security): fs 读限 .md、写拒敏感文件名，收窄任意文件读写面"
```

---

## Task B3: `fetch_url_text` scheme 白名单（防 file:// / SSRF）

**Files:**
- Modify: `src-tauri/src/commands/web.rs`（`fetch_url_text` :10）

**问题:** `fetch_url_text` 无 scheme 校验，`reqwest` 会跟随 `file:///...`（读本地文件）与内网地址。

- [ ] **Step 1: 入口加 scheme 校验**

在 `fetch_url_text` 函数体最前面加：
```rust
// 仅允许 http/https，拒绝 file:// 等（防本地文件读取 / SSRF）
let lower = url.trim().to_ascii_lowercase();
if !(lower.starts_with("http://") || lower.starts_with("https://")) {
    return Err("仅支持 http/https 链接".into());
}
```

- [ ] **Step 2: 补测试**

```rust
#[tokio::test]
async fn rejects_file_scheme() {
    assert!(fetch_url_text("file:///etc/passwd".into()).await.is_err());
    assert!(fetch_url_text("C:/Windows/win.ini".into()).await.is_err());
}
```
Run: `cargo test --manifest-path src-tauri/Cargo.toml web::` → PASS。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/web.rs
git commit -m "fix(security): fetch_url_text 限 http/https，防 file:// 读本地文件"
```

---

## Task B4: `mcp-endpoint.json` 不落 secret + Bearer 常量时间比较

**Files:**
- Modify: `src-tauri/src/mcp/server.rs`（`write_endpoint_file` :546、Bearer 比较 ~:623）
- Modify: `src-tauri/src/commands/mcp.rs`（`mcp_endpoint()` 不回传 secret）— 需先确认前端是否用到 secret
- Modify: `src-tauri/Cargo.toml`（加 `subtle`）

**问题:** `mcp-endpoint.json` 明文写 `{url, secret}`，同用户进程可读；secret 还经 IPC 回传前端 JS。Bearer 用 `==` 短路比较（时序侧信道，纵深）。

**决策依赖:** hook 安装命令（`~/.claude/settings.json`）里 curl 本就带明文 secret，所以 secret 明文存在于用户目录不可完全避免；本 Task 收窄面：endpoint 文件不再冗余存 secret，前端不再拿 secret（安装 hook 全在 Rust 侧）。

- [ ] **Step 1: 确认前端是否依赖 secret**

Run: `grep -rn "endpoint\|secret" src/pages/settings.tsx src/lib/tauri/ipc.ts`
- 若前端只用 `url`（展示端点），直接进 Step 2。
- 若前端读了 `secret`（如自建 curl 展示），保留 `mcp_endpoint()` 返回但从磁盘文件移除；本计划假设前端只需 url（安装 hook 在 Rust 侧）。

- [ ] **Step 2: `write_endpoint_file` 只写 url**

```rust
let body = json!({ "url": url }).to_string(); // 不再落 secret 到磁盘
```

- [ ] **Step 3: Bearer 常量时间比较**

`Cargo.toml` 加 `subtle = "2"`；`server.rs` 比较处：
```rust
use subtle::ConstantTimeEq;
// 原: .map(|t| t == secret)
.map(|t| t.as_bytes().ct_eq(secret.as_bytes()).into())
```
（注意长度不同也要安全处理：`ct_eq` 对不等长返回 0，OK。）

- [ ] **Step 4: 编译 + 冒烟**

Run: `Get-Process pocketbase -ErrorAction SilentlyContinue | Stop-Process -Force; cargo build --manifest-path src-tauri/Cargo.toml`
重启 rework，确认 MCP 工具仍可用（`list_projects` 等），`mcp-endpoint.json` 不再含 secret 字段。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mcp/server.rs src-tauri/src/commands/mcp.rs src-tauri/Cargo.toml
git commit -m "fix(security): endpoint 文件不落 secret + Bearer 常量时间比较"
```

---

## Task B5: 补最小化 CSP + 修 updater 端点占位

**Files:**
- Modify: `src-tauri/tauri.conf.json`（`security.csp` :38、updater endpoints :44）

**问题:** `csp: null` → WebView XSS 可直调所有 IPC（放大 B2）；updater 端点仍是 `OWNER/REPO` 占位（有 pubkey 签名保护不可伪造包，但会发无意义请求）。

- [ ] **Step 1: 设最小化 CSP**

```json
"security": {
  "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' http://127.0.0.1:* http://localhost:*; font-src 'self' data:"
}
```
> `style-src unsafe-inline` 因 Tailwind/shadcn 内联样式必需；`img-src https:` 因阅读页 favicon；`connect-src` 允许本地 PB/MCP。**需重启后逐页验证无 CSP 报错**（尤其 Milkdown 编辑器、图表）。

- [ ] **Step 2: updater 端点**

若暂不发布：删除 `plugins.updater` 整块或将 endpoint 改成真实仓库 URL。保守做法（未发布）：留 pubkey，把 endpoint 换为真实 repo 占位并在 README 标注发布前替换。

- [ ] **Step 3: 逐页验证 CSP**

Run: 重启 rework，打开 DevTools（若可）看 Console 有无 `Refused to ... Content Security Policy`；重点测：看板、文档编辑器（Milkdown）、日历、阅读 favicon、图表页。有报错则按需放宽对应指令。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "fix(security): 补最小化 CSP，收窄 XSS→IPC 面；修 updater 占位端点"
```

---

# Phase C — 性能 / 卡顿

## Task C1: TaskCard 停止订阅全量 labels/states

**Files:**
- Modify: `src/features/board/TaskCard.tsx`（:76-77 订阅）
- Modify: `src/features/board/StatusColumn.tsx`（父层计算 labels/states 传下）

**问题:** 每张卡 `useBoardStore((s) => s.labels)` + `s.states` 订阅整个数组；一次 label/state 实时 echo（含颜色拖拽）→ 该项目**所有卡片**重渲。`memo(TaskCardInner)` 被内部订阅击穿。

**Interfaces:**
- Produces: `TaskCard` 新增 props `taskLabels: BoardLabel[]`（已过滤本卡标签）；`states` 若仅右键菜单用，可懒读 `getState()`。

- [ ] **Step 1: 查清 labels/states 在 TaskCard 内的用途**

Run: `grep -n "labels\|states" src/features/board/TaskCard.tsx`
- `labels`：渲染标签 chip（需要本卡的 label 列表）。
- `states`：大概率仅右键"移动到状态列"菜单用（可改 `getState()` 懒读，参考现有 `moveTo` 已用 `useBoardStore.getState().tasks`）。

- [ ] **Step 2: states 改懒读（去订阅）**

删除 `const states = useBoardStore((s) => s.states);`，在需要 states 的右键菜单渲染处改用 `useBoardStore.getState().states`（菜单打开时才读，非渲染期订阅）。若菜单需响应式，保留但用 `shallow`。

- [ ] **Step 3: labels 由父层传入**

`TaskCard` props 加 `taskLabels: BoardLabel[]`；`TaskCardInner` 内删除 `const labels = useBoardStore((s) => s.labels)`，改用 `props.taskLabels`。在 `StatusColumn.tsx` 渲染卡片处，用 `useMemo` 从 store 的 labels 计算每卡标签后传入：
```tsx
const labels = useBoardStore((s) => s.labels);
// ...map tasks:
<TaskCard task={t} taskLabels={labels.filter((l) => t.labels?.includes(l.id))} ... />
```
（`StatusColumn` 本就渲染整列，集中订阅一次 labels，比每卡订阅省 N-1 次。）

- [ ] **Step 4: 验证**

Run: `npx tsc --noEmit && pnpm test`
Expected: 通过。手动：打开有几十张卡的看板，拖动某状态列颜色/改标签，观察只有相关卡重渲（React DevTools Profiler）。

- [ ] **Step 5: Commit**

```bash
git add src/features/board/TaskCard.tsx src/features/board/StatusColumn.tsx
git commit -m "perf(board): TaskCard 不再订阅全量 labels/states，消除实时 echo 全卡重渲"
```

---

## Task C2: WorkspaceProcesses 轮询在不可见时暂停

**Files:**
- Modify: `src/features/board/WorkspaceProcesses.tsx`（日志轮询 :77、进程刷新 :57）

**问题:** 选中进程后日志 `setInterval 1s` 常驻轮询，tab 不可见/窗口最小化也不停；全局进程页 + 项目进程 tab 同开会双份轮询。

- [ ] **Step 1: 日志轮询加可见性守卫**

```typescript
const t = setInterval(() => {
  // 页面不可见时跳过（省 IPC/CPU；切回来立即 load 一次）
  if (document.visibilityState === "visible") load();
}, 1000);
const onVis = () => {
  if (document.visibilityState === "visible") load();
};
document.addEventListener("visibilitychange", onVis);
return () => {
  cancelled = true;
  clearInterval(t);
  document.removeEventListener("visibilitychange", onVis);
};
```

- [ ] **Step 2: 进程刷新 8s 兜底同样加可见性守卫**（`timer.current = setInterval(...)` 里包 `if visible`）。

- [ ] **Step 3: 验证**

Run: `npx tsc --noEmit`
手动：选中进程后切到别的 app（窗口失焦/最小化），确认 IPC 停（可加临时 console.log 或看后端日志频率），切回立即刷新一次。

- [ ] **Step 4: Commit**

```bash
git add src/features/board/WorkspaceProcesses.tsx
git commit -m "perf(process): 日志/进程轮询在页面不可见时暂停，切回即时刷新"
```

---

## Task C3: render 内重计算补 useMemo（分批）

**Files:**
- Modify: `src/features/board/ProjectWorkspace.tsx`（:88-117 五处 filter/sort/slice）
- Modify: `src/features/board/ProjectSheet.tsx`（`StatesSection` :426 `[...states].sort()`）
- Modify: `src/features/sessions/SessionChat.tsx`（:111 `[...history, ...continued]`）

**问题:** 这些在 render body 直接算数组，订阅的 tasks/sessions/events 一变就全量重跑，且返回新引用击穿子组件 bailout。小数据量不明显，量大才卡。

- [ ] **Step 1: ProjectWorkspace 五处包 useMemo**

`activeTasks`/`catCounts`/`linkedCount`/`upcomingTasks`/`upcomingEvents` 各包 `useMemo(() => ..., [依赖])`（依赖为对应的 tasks/sessions/events 数组 + 相关 id）。

- [ ] **Step 2: StatesSection 排序包 useMemo**

```tsx
const ordered = useMemo(() => [...states].sort((a, b) => a.order - b.order), [states]);
```
（按现有排序键，读源确认字段名。）

- [ ] **Step 3: SessionChat messages 包 useMemo**

```tsx
const messages = useMemo(() => [...history, ...continued], [history, continued]);
```

- [ ] **Step 4: 验证**

Run: `npx tsc --noEmit && pnpm test` → 通过。

- [ ] **Step 5: Commit**

```bash
git add src/features/board/ProjectWorkspace.tsx src/features/board/ProjectSheet.tsx src/features/sessions/SessionChat.tsx
git commit -m "perf: render 内 filter/sort/展开补 useMemo，稳定引用"
```

---

## Task C4: `handle_ps` 阻塞调用移出 tokio worker

**Files:**
- Modify: `src-tauri/src/runtime/daemon.rs`（`handle_ps` :348）

**问题:** `handle_ps`(async) 内同步跑 `sync_process_status()`（spawn tasklist）+ 健康 TCP（2s 超时），阻塞 tokio worker，进程多时耗线程池、拖累 MCP 与其他 async 命令。

- [ ] **Step 1: 阻塞段包 spawn_blocking**

将 `handle_ps` 内的 `sync_process_status()` 及后续同步的资源/健康采集用 `tokio::task::spawn_blocking` 包裹后 `.await`：
```rust
// 同步的 tasklist/健康检查移到阻塞线程池，不占 async worker
tokio::task::spawn_blocking(|| super::process::sync_process_status())
    .await
    .ok();
```
（若健康检查在 `start_background_tasks` 的循环里，另见 C4b：health::check 同样应 spawn_blocking——本 Task 先修 ps 热路径。）

- [ ] **Step 2: 编译 + 冒烟**

Run: `Get-Process pocketbase -ErrorAction SilentlyContinue | Stop-Process -Force; cargo build --manifest-path src-tauri/Cargo.toml`
手动：起若干进程，狂刷「进程」页，观察 UI 不卡、MCP 仍响应。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/runtime/daemon.rs
git commit -m "perf(runtime): handle_ps 阻塞采集移入 spawn_blocking，不占 tokio worker"
```

---

# Phase D — 架构 / 技术债

## Task D1: 删 `process.rs` 死代码

**Files:**
- Modify/Delete: `src-tauri/src/runtime/process.rs`（删 `start`/`stop`/`restart`/`ps` 四函数；保留 `is_pid_alive`/`alive_pid_set`/`sync_process_status`）
- Modify: `src-tauri/src/runtime/mod.rs`（若有对应导出/引用）

**问题:** `process.rs` 的 `start/stop/restart/ps`（含不可达的中文字节切片 panic）去 TCP 后零调用者，414 行里约一半是死代码，且是"将来误接入就崩"的隐患。

**Interfaces:**
- Consumes（保留）: `sync_process_status()`、`is_pid_alive()`、`alive_pid_set()`（被 daemon.rs 用）。
- 删除: `pub fn start/stop/restart/ps`。

- [ ] **Step 1: 确认零调用者**

Run: `grep -rn "process::\(start\|stop\|restart\|ps\)\b\|proc_util::\(start\|stop\|restart\|ps\)" src-tauri/src`
Expected: 空（已核实）。若非空则先处理调用点。

- [ ] **Step 2: 删四个死函数**（`start` :108、`stop` :258、`restart` :301、`ps` :338），保留 `is_pid_alive`/`alive_pid_set`/`sync_process_status` 及 imports 按需清理。

- [ ] **Step 3: 编译（clippy 查未用 import）**

Run: `Get-Process pocketbase -ErrorAction SilentlyContinue | Stop-Process -Force; cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -i warn`
清掉因删函数产生的 unused import（`Command`/`json`/`Uuid` 等若不再用）。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/runtime/
git commit -m "refactor(runtime): 删 process.rs 死代码(start/stop/restart/ps)，消除误用隐患"
```

---

## Task D2: 清 claude-runtime 命名/文案残留

**Files:**
- Modify: `src/pages/processes.tsx:13`、`src/features/board/WorkspaceProcesses.tsx:56,121`、`src/features/board/ProjectWorkspace.tsx:190,378`、`src/types/runtime.ts:20`、`src-tauri/src/commands/mod.rs:37`、`src-tauri/src/mcp/intercept.rs:2,6,10,34`、`src-tauri/src/runtime/logs.rs:71`、`src-tauri/src/runtime/clean.rs:44`

**问题:** 去 TCP 后注释/UI 文案仍写 "claude-runtime/:19191/daemon/外部 daemon"，误导用户与维护者。

- [ ] **Step 1: 前端文案**

Run: `grep -rn "claude-runtime\|:19191\|外部 daemon\|外部\s*daemon" src/`
逐条改：`processes.tsx:13` 的"与终端 claude-runtime 共享同一批进程" → "由 rework 托管的进程"；WorkspaceProcesses 注释去掉"外部 daemon 场景"表述。

- [ ] **Step 2: 后端注释**

Run: `grep -rn "claude-runtime\|:19191\|daemon" src-tauri/src/mcp/intercept.rs src-tauri/src/commands/mod.rs src-tauri/src/runtime/logs.rs src-tauri/src/runtime/clean.rs`
更新 `intercept.rs` 顶部注释（去掉":19191"、"连进程内 daemon"过时描述）；`clean.rs:44` 的 `println!("claude-runtime clean ...")` 改中性文案。

- [ ] **Step 3: 验证**

Run: `npx tsc --noEmit`；`grep -rn "19191" src src-tauri/src`（应为空或仅剩历史无关项）。

- [ ] **Step 4: Commit**

```bash
git add src src-tauri/src
git commit -m "chore: 清理 claude-runtime/:19191/daemon 命名与文案残留"
```

> 注：`~/.claude-runtime/` **数据目录路径**本 Task **不动**（改路径涉及数据迁移，风险单列；沿用现有决策"数据目录暂不动"）。仅清文案。

---

## Task D3: 抽前端 AI JSON 解析公用工具

**Files:**
- Create: `src/lib/ai-json-parse.ts`
- Modify: `src/features/chemistry/extract.ts`、`src/features/memory/extract.ts`、`src/features/reading/reading-utils.ts`（去各自重复的去围栏/截 `{...}`/parse/`asString`）

**问题:** 三处各有一份"去 ```围栏 → 截 `{...}` → JSON.parse → 字段校验"逻辑 + 各一份 `asString`，重复。

**Interfaces:**
- Produces: `parseJsonReply(s: string): unknown | null`（去围栏+截取+parse，失败返 null）；`asString(v: unknown): string`。

- [ ] **Step 1: 写测试**（`src/lib/__tests__/ai-json-parse.test.ts`）覆盖：带 ```json 围栏、前后有解释文字、非法 JSON 返回 null、`asString` 对 number/null/array 的行为。
- [ ] **Step 2: Run 失败** → `pnpm test ai-json-parse` FAIL。
- [ ] **Step 3: 实现 `ai-json-parse.ts`**（合并三处最健壮的实现：正则去 ```围栏、找首个 `{` 到末个 `}`、try parse）。
- [ ] **Step 4: 三处改为引用公用函数**，删本地重复。保留各自领域的**字段校验**（不同结构，不合并）。
- [ ] **Step 5: Run 全测** → `pnpm test && npx tsc --noEmit` PASS（含 chemistry/memory 既有 extract 测试不回归）。
- [ ] **Step 6: Commit** — `refactor(ai): 抽 lib/ai-json-parse 去三处重复解析`

---

## Task D4: 后端 AI HTTP 层去重 + max_tokens 可配

**Files:**
- Modify: `src-tauri/src/commands/ai.rs`（`ai_chat`/`list_models`/`ai_chat_tools`/`ai_stream_run` 四处重复 client+header；`max_tokens:4096` 硬编码两处）
- Modify: `src-tauri/src/providers/mod.rs`（或新建 `util.rs`）合并 `truncate` 三处

**问题:** 4 处各建 `reqwest::Client` + 重复 `is_anthropic` header 组装；`max_tokens:4096` 硬编码且不可配（现代模型可 8192）；`truncate` 在 claude.rs×2 + codex.rs×1 重复。

- [ ] **Step 1: 提取 `fn build_request(config, method, url) -> RequestBuilder`**（含 is_anthropic 分支的 header/auth），四处替换。
- [ ] **Step 2: `AiConfig` 加 `max_tokens: Option<u32>`（默认 4096）**，`anthropic_body`/`anthropic_tools_body` 读该值。前端 `settings.ts`/类型同步加可选字段（默认不填=4096）。
- [ ] **Step 3: `truncate` 提到 `providers/mod.rs`**，三处引用。
- [ ] **Step 4: 编译 + 既有 ai.rs 单测不回归** → `cargo test --manifest-path src-tauri/Cargo.toml ai::`。
- [ ] **Step 5: Commit** — `refactor(ai): HTTP 请求层去重 + max_tokens 可配 + truncate 合并`

---

## Task D5: 拆 `settings.tsx`（1072 行上帝组件）— 🔴 大，可延后

**Files:**
- Create: `src/features/settings/`（`ShortcutSection.tsx`/`AiSection.tsx`/`EmbedSection.tsx`/`McpSection.tsx`/`ClaudeIntegrationSection.tsx`/`NotifyPrefsSection.tsx` 等）
- Modify: `src/pages/settings.tsx`（改为组合各 section）
- Create: `src/store/embed.ts`（embed 配置独立出 settings store）

**问题:** 1072 行、12 个 section、父层全量订阅 settings store。拆分后各 section 精确订阅、可懒加载。

- [ ] **Step 1: 逐 section 外提到 `features/settings/`**（一次一个，每个提完 `tsc` + reload 验证该区块功能不变）。
- [ ] **Step 2: `embedConfig` 状态提到 `store/embed.ts`**，EmbedSection 精确订阅。
- [ ] **Step 3: `settings.tsx` 改为 `<ShortcutSection/> <AiSection/> ...` 组合**，父层不再全量订阅。
- [ ] **Step 4: 逐区块手测**（快捷键捕获、AI 配置保存、embed provider 隔离、MCP、Claude 集成开关、通知偏好）。
- [ ] **Step 5: Commit（建议每提 1-2 个 section 一次提交，便于回退）。**

> 此 Task 独立、无数据风险，可放到最后或单独排期。

---

## Task D6: 工程基建 — ESLint + clippy + 最小 CI

**Files:**
- Create: `eslint.config.js`、`.github/workflows/ci.yml`、（可选）`rustfmt.toml`
- Modify: `package.json`（加 lint script + devDeps）

**问题:** 无 ESLint/clippy/CI；`tsc + vitest` 手动跑。回归靠记忆。

- [ ] **Step 1: 装 ESLint flat config**（`eslint`、`@typescript-eslint/*`、`eslint-plugin-react-hooks`），规则以 `react-hooks/exhaustive-deps` warn + `@typescript-eslint/no-floating-promises` 为重点（能抓 A4 类未处理 promise）。`package.json` 加 `"lint": "eslint src"`。
- [ ] **Step 2: 先 `eslint src` 看存量告警**，本 Task 只配置+修致命项，存量 warn 记入 backlog（不在本 Task 全清）。
- [ ] **Step 3: 加 CI**（GitHub Actions）：`pnpm install` → `pnpm test` → `npx tsc --noEmit` → `cargo test` → `cargo clippy -- -D warnings`（clippy 若存量告警多，先 `-W` 不 `-D`，逐步收紧）。
- [ ] **Step 4: Commit** — `chore(ci): 加 ESLint/clippy/GitHub Actions 最小流水线`

> clippy 加 `-D warnings` 前需先跑一遍清存量，否则 CI 直接红。建议本 Task 先 warn-only，收紧留后续。

---

## Task D7: 依赖固定版本 + 三套记忆系统文档化 — 🟡 收尾

**Files:**
- Modify: `package.json`（5 个 `latest` → 锁定实际版本）
- Create: `docs/memory-systems.md`（三套记忆职责说明）

**问题:** `pocketbase/zustand/react-router-dom/@vitejs-plugin-react/tailwindcss` 用 `latest` 不可重现；三套记忆（Claude 文件 / claude-mem / rework 账本）无统一说明，用户困惑。

- [ ] **Step 1: 把 5 个 `latest` 改成 `pnpm ls` 当前实际版本号**（`^` 前缀锁 minor）。Run: `pnpm ls pocketbase zustand react-router-dom @vitejs/plugin-react tailwindcss`。
- [ ] **Step 2: `pnpm install` 确认 lock 无漂移**、`pnpm build` 通过。
- [ ] **Step 3: 写 `docs/memory-systems.md`**：三套各自职责、数据落点、rework 账本是唯一"产品内"记忆、claude-mem 与文件记忆的关系与导入桥接现状。（纯文档，不改代码逻辑。）
- [ ] **Step 4: Commit** — `chore: 锁定核心依赖版本 + 文档化三套记忆系统`

---

# 建议执行顺序 & 工作量

| Phase | 内容 | 工作量 | 建议 |
|---|---|---|---|
| **A** | A1/A3/A5 🟢 · A2/A4 🟡 | ~1-1.5 天 | **先做**，用户必然撞上的崩溃/丢数据 |
| **B** | B2/B3/B5 🟢 · B1/B4 🟡 | ~1 天 | 次做，B5(CSP) 需逐页验证留足时间 |
| **C** | C1/C2 🟢 · C3/C4 🟡 | ~1 天 | 快赢，消真实卡顿 |
| **D** | D1/D2/D3 🟢 · D4/D6/D7 🟡 · D5 🔴 | ~2-3 天 | D1/D2 顺手清尾巴；D5 可单独排期 |

**风险提示:**
- A2（锁）/B4（去 secret）/C4（spawn_blocking）需 `cargo build` + 重启验证，注意先杀 pocketbase 释放 target 锁。
- B5（CSP）是本计划**最需人工回归**的一项——CSP 收紧可能挡住 Milkdown/图表/字体，逐页验证。
- D5（拆 settings）体量大、纯前端、无数据风险，建议放最后或单独开分支。

---

## Self-Review

- **Spec 覆盖:** A/B/C/D 四组审计发现均有对应 Task；已核实的误报（process.rs 切片 panic）明确标注为死代码删除（D1）而非崩溃修复。
- **无占位符:** 机械修复（A1-A5、B2/B3/B5、C1/C2、B4）给了确切代码；结构性项（A2/B1/C3/C4/D3-D7）给了确切文件+步骤+验证命令。
- **类型/命名一致:** `has_shell_metachars`、`build_request`、`parseJsonReply`、`table_lock` 在定义与引用处一致；迁移文件名递增 `1720002200_`。
