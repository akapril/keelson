# 交互式 PTY 进程（sudo 密码）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面进程管理增加交互式启动路径：进程跑在 PTY 中、前端内嵌可输入 xterm，用户直接敲 sudo 密码；输出 tee 到日志、进程照旧受管、看门狗关闭。

**Architecture:** 复用 `portable-pty`；后端 `InteractivePtyRegistry` 挂 `AppState`，reader 线程把 PTY 输出经 Tauri `emit("runtime-pty-output:<id>")` 推前端并 tee 日志，输入/尺寸经新 invoke 命令回传；前端 `InteractivePtyView`（xterm.js 接 Tauri 事件）内嵌进程视图右侧。

**Tech Stack:** Rust / Tauri v2 / portable-pty / parking_lot；React 19 / TS / xterm.js / react-i18next。

## Global Constraints

- 信任模型同现有 headless 手动启动（本机用户命令，非 web 攻击面）；command 作 shell 单一参数传入，不拼进 shell 字符串。
- 密码等运行时输入只经 PTY stdin 实时透传，**绝不落盘**、不写进程表 command 字段。tee 只写 PTY 输出（不写 input）。
- `interactive` 进程 `max_restarts` 强制为 0，不接看门狗自动重启。
- 事件名带进程 id（`runtime-pty-output:<id>` / `runtime-pty-exit:<id>`），前端只订阅自己那路。
- 中文注释；前端不硬编码颜色（用语义色 token）；文案走 i18n（`board` namespace，zh/en 双语）。
- 不改 headless 路径默认行为：非交互进程完全不受影响。
- `ProcessEntry` 新字段用 `#[serde(default)]` 兼容旧记录。
- Windows 本地 `cargo test --lib` 有 0xc0000139 限制（Tauri GUI DLL），Rust 纯函数测试靠 CI(ubuntu)/standalone rustc；PTY IO 属集成，靠真机验证。

---

### Task 1: ProcessEntry 加 `interactive` 字段

**Files:**
- Modify: `src-tauri/src/runtime/store.rs`（`ProcessEntry` 结构体 + 可能的构造点）
- Modify: `src-tauri/src/runtime/daemon.rs`（`handle_start` / 看门狗重启处的 `ProcessEntry { .. }` 字面量补字段）

**Interfaces:**
- Produces: `ProcessEntry.interactive: bool` 字段（`#[serde(default)]`），供 Task 3 交互启动置 true、Task 4 判 restart 语义、前端 Task 6 类型。

- [ ] **Step 1: 写失败测试**（store.rs `#[cfg(test)]` 内）

```rust
#[test]
fn process_entry_interactive_defaults_false_when_absent() {
    // 旧记录 JSON 无 interactive 字段 → 反序列化应默认 false（serde(default)）
    let json = r#"{
        "id":"abc123","name":"web","command":"npm run dev","cwd":"/tmp",
        "pid":1234,"port":[],"status":"running","started_at":"2026-07-29T00:00:00Z",
        "max_restarts":0,"restart_count":0
    }"#;
    let e: ProcessEntry = serde_json::from_str(json).expect("反序列化旧记录");
    assert!(!e.interactive);
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cargo test -p rework --lib runtime::store::tests::process_entry_interactive_defaults_false_when_absent`
Expected: 编译失败（`interactive` 字段不存在）或断言失败。
（Windows 本地若报 0xc0000139，改用 CI 或 `cargo test --no-run` 验证编译；断言逻辑靠 CI。）

- [ ] **Step 3: 加字段**

在 `ProcessEntry` 结构体末尾加（紧邻现有字段，保持注释风格）：

```rust
    /// 交互式 PTY 进程标记：true=经交互 PTY 启动（sudo 等需 stdin 的命令）。
    /// 看门狗不接管、restart 需用户重新交互启动。#[serde(default)] 兼容旧记录（默认 false）。
    #[serde(default)]
    pub interactive: bool,
```

- [ ] **Step 4: 修所有 `ProcessEntry { .. }` 构造点**

编译器会指出缺字段处（daemon.rs `handle_start` 的 `entry`、看门狗重启重建的 entry 等）。逐一补 `interactive: false,`（headless 路径恒 false）。

- [ ] **Step 5: 运行测试，确认通过 + 全量编译**

Run: `cargo test -p rework --lib runtime::store` 然后 `cargo build -p rework`
Expected: 测试 PASS；`cargo build` 无缺字段错误。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/runtime/store.rs src-tauri/src/runtime/daemon.rs
git commit -m "feat(runtime): ProcessEntry 加 interactive 字段(serde default 兼容旧记录)"
```

---

### Task 2: InteractivePtyRegistry（runtime/pty.rs）

**Files:**
- Create: `src-tauri/src/runtime/pty.rs`
- Modify: `src-tauri/src/runtime/mod.rs`（`pub mod pty;`）

**Interfaces:**
- Consumes: `store::update_process`（标记 exited）、`portable_pty`。
- Produces:
  - `pub fn build_shell_invocation(command: &str) -> (String, Vec<String>)`（纯函数，可测）
  - `pub struct InteractivePtyRegistry`，方法：
    - `pub fn new() -> Self`
    - `pub fn open(self: &std::sync::Arc<Self>, app: tauri::AppHandle, id: &str, command: &str, cwd: &str, env: &std::collections::HashMap<String,String>, log_path: std::path::PathBuf) -> Result<(), String>`
    - `pub fn input(&self, id: &str, data: &[u8]) -> Result<(), String>`
    - `pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String>`
    - `pub fn kill(&self, id: &str) -> Result<(), String>`
    - `pub fn kill_all(&self)`
  - 供 Task 3 命令与 AppState 使用。

- [ ] **Step 1: 写失败测试**（pty.rs 末尾 `#[cfg(test)]`）

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// command 必须作 shell 的单一参数传入（含 `;` 等元字符不拆分）。
    #[test]
    fn shell_invocation_passes_command_as_single_arg() {
        let (prog, args) = build_shell_invocation("sudo whoami; echo hi");
        #[cfg(unix)]
        {
            assert_eq!(prog, "sh");
            assert_eq!(args, vec!["-c".to_string(), "sudo whoami; echo hi".to_string()]);
        }
        #[cfg(windows)]
        {
            assert_eq!(prog, "cmd");
            assert_eq!(args[0], "/C");
            // chcp 前缀 + 原命令作单段（不因 ; 而拆成多参数）
            assert!(args[1].starts_with("chcp 65001>nul &&"));
            assert!(args[1].ends_with("sudo whoami; echo hi"));
            assert_eq!(args.len(), 2);
        }
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cargo test -p rework --lib runtime::pty::tests::shell_invocation_passes_command_as_single_arg`
Expected: 编译失败（`build_shell_invocation` 未定义）。

- [ ] **Step 3: 实现 pty.rs**

```rust
//! 交互式 PTY 进程：把任意本机命令 spawn 进伪终端，输出经 Tauri 事件推前端并 tee 日志，
//! stdin 经命令回传。用于需交互输入的启动（sudo 密码、ssh 指纹、任意 read 提示）。
//!
//! 与 `web/terminal.rs` 的 `PtyRegistry` 独立：那个只跑 provider CLI 的 argv（web 攻击面，
//! 严格 argv 化）；本模块跑桌面手动启动的任意 shell 命令（与 headless `handle_start` 同信任模型）。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tauri::{AppHandle, Emitter};

use super::store;

/// 构建交互 PTY 的 shell 调用（与 headless 手动启动同壳，命令语义一致）。
/// command 作 shell 的**单一参数**传入，元字符不额外拆分（不引入新注入面）。
pub fn build_shell_invocation(command: &str) -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        // chcp 65001 强制子进程 UTF-8 输出，避免 GBK 乱码（与 daemon.rs 一致）
        (
            "cmd".to_string(),
            vec!["/C".to_string(), format!("chcp 65001>nul && {command}")],
        )
    }
    #[cfg(unix)]
    {
        ("sh".to_string(), vec!["-c".to_string(), command.to_string()])
    }
}

/// 单个交互 PTY 会话：writer(=stdin)、master(resize/克隆 reader)、child(kill/收尸)。
struct InteractivePtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

/// 交互 PTY 注册表：`进程 id -> 会话`。挂 `AppState`（`Arc` 共享），供命令与退出钩子访问。
pub struct InteractivePtyRegistry {
    sessions: Mutex<HashMap<String, InteractivePtySession>>,
}

impl Default for InteractivePtyRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl InteractivePtyRegistry {
    pub fn new() -> Self {
        Self { sessions: Mutex::new(HashMap::new()) }
    }

    /// 开一个交互 PTY 会话跑 `command`，起 reader 线程 emit 输出 + tee 日志。
    pub fn open(
        self: &Arc<Self>,
        app: AppHandle,
        id: &str,
        command: &str,
        cwd: &str,
        env: &HashMap<String, String>,
        log_path: PathBuf,
    ) -> Result<(), String> {
        if self.sessions.lock().contains_key(id) {
            return Err(format!("交互 PTY 会话已存在: {id}"));
        }

        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("openpty 失败: {e}"))?;

        // shell 单参数化：command 不拼进 shell 字符串。
        let (prog, args) = build_shell_invocation(command);
        let mut builder = CommandBuilder::new(&prog);
        for a in &args {
            builder.arg(a);
        }
        builder.cwd(cwd);
        for (k, v) in env {
            builder.env(k, v);
        }

        let child = pair
            .slave
            .spawn_command(builder)
            .map_err(|e| format!("spawn 交互进程失败: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("获取 PTY writer 失败: {e}"))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("克隆 PTY reader 失败: {e}"))?;

        self.sessions.lock().insert(
            id.to_string(),
            InteractivePtySession { writer, master: pair.master, child },
        );

        // reader 线程：读 PTY → ① emit 给前端 ② 追加写日志（tee）。EOF/错误 → emit exit + 收尸。
        let reg = Arc::clone(self);
        let id_owned = id.to_string();
        let out_event = format!("runtime-pty-output:{id}");
        let exit_event = format!("runtime-pty-exit:{id}");
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .ok();
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = buf[..n].to_vec();
                        // 输出经 Tauri 事件推前端（payload = number[]，前端转 Uint8Array）
                        let _ = app.emit(&out_event, chunk.clone());
                        // tee 到日志文件（仅输出，不含 stdin/密码）
                        if let Some(f) = log.as_mut() {
                            let _ = f.write_all(&chunk);
                        }
                    }
                    Err(_) => break,
                }
            }
            // 退出：收尸移除会话、标记进程表 exited、通知前端。
            reg.remove_finished(&id_owned);
            store::update_process(&id_owned, |e| e.status = "exited".to_string());
            let _ = app.emit(&exit_event, ());
        });

        Ok(())
    }

    /// 写 stdin（浏览器/前端键入 → PTY）。data 为原始字节（含密码，绝不落日志）。
    pub fn input(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut guard = self.sessions.lock();
        let s = guard.get_mut(id).ok_or_else(|| format!("交互 PTY 会话不存在: {id}"))?;
        s.writer.write_all(data).map_err(|e| format!("写 PTY 失败: {e}"))?;
        s.writer.flush().map_err(|e| format!("flush PTY 失败: {e}"))
    }

    /// 调整 PTY 窗口尺寸。
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let guard = self.sessions.lock();
        let s = guard.get(id).ok_or_else(|| format!("交互 PTY 会话不存在: {id}"))?;
        s.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("resize PTY 失败: {e}"))
    }

    /// reader 线程退出时调用：仅从表移除会话并收尸（child 已自然退出）。
    fn remove_finished(&self, id: &str) {
        if let Some(mut s) = self.sessions.lock().remove(id) {
            let _ = s.child.wait();
        }
    }

    /// 主动终止会话：kill + wait + 移除（供 stop 命令 / 退出清场用）。
    pub fn kill(&self, id: &str) -> Result<(), String> {
        let mut s = {
            let mut guard = self.sessions.lock();
            guard.remove(id).ok_or_else(|| format!("交互 PTY 会话不存在: {id}"))?
        };
        let res = s.child.kill().map_err(|e| format!("kill 交互进程失败: {e}"));
        let _ = s.child.wait();
        res
    }

    /// 清场全表（app 退出钩子调用），杜绝孤儿。
    pub fn kill_all(&self) {
        let drained: Vec<(String, InteractivePtySession)> =
            { self.sessions.lock().drain().collect() };
        for (_id, mut s) in drained {
            let _ = s.child.kill();
            let _ = s.child.wait();
        }
    }
}
```

在 `runtime/mod.rs` 加 `pub mod pty;`（与现有 `pub mod ...` 并列）。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cargo test -p rework --lib runtime::pty::tests::shell_invocation_passes_command_as_single_arg`
Expected: PASS（Windows 本地 0xc0000139 则靠 CI；`cargo build -p rework` 须过）。

- [ ] **Step 5: 编译**

Run: `cargo build -p rework`
Expected: 无错误、无 warning（未用符号会有 warning，Task 3 接线后消解；本任务允许 `dead_code` warning，或加 `#[allow(dead_code)]` 到 registry 上并在 Task 3 移除）。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/runtime/pty.rs src-tauri/src/runtime/mod.rs
git commit -m "feat(runtime): InteractivePtyRegistry — 任意命令跑 PTY，输出 emit+tee 日志"
```

---

### Task 3: Tauri 命令 + AppState 接线 + 退出清场

**Files:**
- Create: `src-tauri/src/commands/runtime_pty.rs`
- Modify: `src-tauri/src/commands/mod.rs`（`pub mod runtime_pty;`）
- Modify: `src-tauri/src/lib.rs`（AppState 加字段 + Default 初始化 + generate_handler 注册 3 命令 + RunEvent::Exit 加 kill_all）

**Interfaces:**
- Consumes: Task 2 的 `InteractivePtyRegistry`；Task 1 的 `ProcessEntry.interactive`；`store`（find_process/save/stdout_dir）。
- Produces: 3 个 `#[tauri::command]`：
  - `runtime_pty_start(app: AppHandle, state: State<AppState>, command: String, name: String, cwd: String) -> Result<serde_json::Value, String>`（返回创建的进程条目 JSON）
  - `runtime_pty_input(state: State<AppState>, id: String, data: String) -> Result<(), String>`
  - `runtime_pty_resize(state: State<AppState>, id: String, cols: u16, rows: u16) -> Result<(), String>`
  - 供前端 Task 6 ipc 调用。

- [ ] **Step 1: 实现 commands/runtime_pty.rs**

```rust
//! 桌面交互式 PTY 进程命令：start/input/resize。emit 需 AppHandle，故独立于 runtime_command。

use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::AppState;
use crate::runtime::store::{self, ProcessEntry};

/// 交互式启动：跑 PTY、写进程表（interactive=true，max_restarts 强制 0），返回条目 JSON。
#[tauri::command]
pub async fn runtime_pty_start(
    app: AppHandle,
    state: State<'_, AppState>,
    command: String,
    name: String,
    cwd: String,
) -> Result<serde_json::Value, String> {
    let command = command.trim().to_string();
    if command.is_empty() {
        return Err("命令为空".to_string());
    }
    if store::find_process(&name).is_some() {
        return Err(format!("进程名称 '{name}' 已存在，请先停止该进程"));
    }

    let id = Uuid::new_v4().to_string()[..6].to_string();
    let log_path = store::stdout_dir().join(format!("{id}.log"));

    // 先建日志文件（tee 目标；reader 线程 append 打开）
    std::fs::File::create(&log_path).map_err(|e| format!("无法创建日志文件: {e}"))?;

    let env = std::collections::HashMap::new();
    state
        .runtime_pty
        .open(app, &id, &command, &cwd, &env, log_path)?;

    // 字段严格对齐 store.rs 的 ProcessEntry 定义（health 是 String 非 Option；有 env 字段）。
    let entry = ProcessEntry {
        id: id.clone(),
        name: name.clone(),
        command: command.clone(),
        cwd: cwd.clone(),
        pid: 0, // 交互 PTY 由 registry 持 child；PID 判活对其不适用（Task 4 跳过），靠 exit 事件清理
        port: Vec::new(),
        status: "running".to_string(),
        started_at: chrono::Utc::now(),
        max_restarts: 0, // 交互进程强制不接看门狗
        restart_count: 0,
        health_url: None,
        health: "unknown".to_string(),
        env: std::collections::HashMap::new(),
        session_id: None,
        provider: None,
        interactive: true,
    };
    store::add_process(entry.clone());

    serde_json::to_value(&entry).map_err(|e| format!("序列化进程条目失败: {e}"))
}

/// 向交互 PTY 写 stdin（键入/密码）。
#[tauri::command]
pub async fn runtime_pty_input(
    state: State<'_, AppState>,
    id: String,
    data: String,
) -> Result<(), String> {
    state.runtime_pty.input(&id, data.as_bytes())
}

/// 调整交互 PTY 尺寸。
#[tauri::command]
pub async fn runtime_pty_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.runtime_pty.resize(&id, cols, rows)
}

/// 停止交互 PTY 会话：interactive 进程 pid=0，不能走 daemon 的 PID kill，必须经 registry。
/// kill 后把进程表条目标 exited（reader 线程收到 EOF 亦会标，双保险幂等）。
#[tauri::command]
pub async fn runtime_pty_kill(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let res = state.runtime_pty.kill(&id);
    store::update_process(&id, |e| e.status = "exited".to_string());
    res
}
```

> 实现者注意：`ProcessEntry` 的确切字段/构造以 store.rs 现有定义为准（上面 health/session_id 等按现有类型填 `None`/默认）。`store::add_process`（或等价的「插入并保存」函数）以 store.rs 现有 API 为准；若无单条插入函数，用 `load_processes` + push + `save_processes` 模式，或复用 daemon.rs 写入进程表的同一函数。`pid` 判活：交互进程 pid=0 会被 `sync_process_status` 视为「非存活」误标 exited——故 **Task 4 需让判活/同步跳过 `interactive && registry 仍持有` 的会话**（见 Task 4）。

- [ ] **Step 2: AppState 接线（lib.rs）**

`AppState` 结构体加字段（紧邻 `web_pty`）：

```rust
    /// 交互式 PTY 进程注册表（sudo 等）：桌面进程管理的交互启动路径。
    pub runtime_pty: Arc<runtime::pty::InteractivePtyRegistry>,
```

`Default for AppState` 加初始化：

```rust
            runtime_pty: Arc::new(runtime::pty::InteractivePtyRegistry::new()),
```

`commands/mod.rs` 加 `pub mod runtime_pty;`。

`generate_handler!` 数组加（进程管理分组下）：

```rust
            commands::runtime_pty::runtime_pty_start,
            commands::runtime_pty::runtime_pty_input,
            commands::runtime_pty::runtime_pty_resize,
            commands::runtime_pty::runtime_pty_kill,
```

`RunEvent::Exit` 块内 `state.web_pty.kill_all();` 之后加：

```rust
                // 交互 PTY 同样退出清场，杜绝孤儿。
                state.runtime_pty.kill_all();
```

- [ ] **Step 3: 编译**

Run: `cargo build -p rework`
Expected: 无错误。若 `add_process` 等 API 名不符，按 store.rs 实际调整。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/runtime_pty.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(runtime): 交互 PTY 命令 start/input/resize + AppState 接线 + 退出清场"
```

---

### Task 4: 判活与 restart 对交互进程的语义

**Files:**
- Modify: `src-tauri/src/runtime/process.rs`（`sync_process_status` 跳过交互进程）
- Modify: `src-tauri/src/runtime/daemon.rs`（`handle_restart` 对交互进程的语义；stop 复用 registry.kill）

**Interfaces:**
- Consumes: `ProcessEntry.interactive`；`InteractivePtyRegistry`（经 AppState，或 stop 走现有 PID kill 亦可）。
- Produces: 交互进程不被 PID 判活误标、restart 不无 TTY 重跑。

- [ ] **Step 1: 写失败测试**（process.rs `#[cfg(test)]`，纯逻辑：判活跳过 interactive）

```rust
#[test]
fn sync_skips_interactive_processes() {
    // interactive 进程 pid=0，不应被 alive-set 判活逻辑误标 exited。
    // 抽出纯判定函数 should_mark_exited(entry, alive_set) 便于测试。
    use std::collections::HashSet;
    let alive: HashSet<u32> = HashSet::new(); // 空存活集
    let mut e = sample_running_entry();
    e.pid = 0;
    e.interactive = true;
    assert!(!should_mark_exited(&e, &alive)); // 交互进程：跳过，不误标
    e.interactive = false;
    e.pid = 4321;
    assert!(should_mark_exited(&e, &alive)); // 普通进程 pid 不在存活集 → 标 exited
}
```

（同文件加最小 `sample_running_entry()` helper 构造一个 running 的 `ProcessEntry`。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `cargo test -p rework --lib runtime::process::tests::sync_skips_interactive_processes`
Expected: 编译失败（`should_mark_exited` 未定义）。

- [ ] **Step 3: 抽纯判定函数并接入 sync**

在 process.rs 加：

```rust
/// 是否应把某 running 进程标记为 exited。交互 PTY 进程 pid=0、生命周期由
/// InteractivePtyRegistry 的 reader 线程管理（退出时自己 emit + 标 exited），
/// PID 判活对其不适用 → 一律跳过，避免误标。
pub fn should_mark_exited(entry: &ProcessEntry, alive: &HashSet<u32>) -> bool {
    if entry.interactive {
        return false;
    }
    !alive.contains(&entry.pid)
}
```

`sync_process_status` 里两处判定改用它：

```rust
        Some(alive) => {
            for entry in running {
                if should_mark_exited(entry, &alive) {
                    store::update_process(&entry.id, |e| e.status = "exited".to_string());
                }
            }
        }
```

（`None` 回退分支：`if entry.interactive { continue; }` 后再 `is_pid_alive`。）

- [ ] **Step 4: restart 语义（daemon.rs `handle_restart`）**

在 `handle_restart` 取到 entry 后，最前面加交互短路：

```rust
    // 交互进程无 TTY 无法无人值守重跑：仅停止（kill PTY 会话），提示用户重新交互启动。
    if entry.interactive {
        // 停止：交互 PTY 由 registry 持有 child；此处经现有 stop 路径终止即可。
        // （PID kill 对 pid=0 无效，故走 registry.kill——但 daemon 无 AppState；
        //  统一改由前端 stop 走 runtime_pty 停止，或在此返回提示不自动重启。）
        return json!({"error":"交互进程请停止后重新交互启动（restart 不支持无人值守重跑）"});
    }
```

> 实现者注意 stop 路径：交互进程 pid=0，daemon 的 `handle_stop` 用 `taskkill/kill PID` 对 pid=0 无效，故**不走 daemon stop**。停止交互进程走 Task 3 已定义的 `runtime_pty_kill` 命令（`registry.kill` + 标 exited），由前端 Task 8 的停止按钮对 `interactive` 进程调用。本任务只需保证 `handle_restart` 对交互进程返回上述提示、不自动重跑。

- [ ] **Step 5: 运行测试 + 编译**

Run: `cargo test -p rework --lib runtime::process` 然后 `cargo build -p rework`
Expected: 测试 PASS；编译过。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/runtime/process.rs src-tauri/src/runtime/daemon.rs src-tauri/src/commands/runtime_pty.rs src-tauri/src/lib.rs
git commit -m "feat(runtime): 交互进程判活跳过 + restart 语义 + runtime_pty_kill"
```

---

### Task 5: 抽共享 xterm 工具（重构，行为不变）

**Files:**
- Create: `src/components/terminal/xterm-shared.ts`
- Modify: `src/components/terminal/XtermView.tsx`（改为 import 共享 util）

**Interfaces:**
- Produces:
  - `export function resolveXtermTheme(): { background; foreground; cursor; selectionBackground }`
  - `export function makeSafeFit(container: () => HTMLElement | null, fit: () => void): () => boolean`
  - 供 Task 7 `InteractivePtyView` 复用。

- [ ] **Step 1: 建 xterm-shared.ts**

把 `XtermView.tsx` 现有的 `resolveXtermTheme` + `cssVarToColor` 原样搬入并 `export`。`safeFit` 抽成工厂（因依赖组件内 `containerRef`/`fitAddon`）：

```ts
/**
 * 生成 safeFit：容器可见（有实际尺寸）时才 fit，避免 keep-alive 布局下容器
 * display:none（0 尺寸）时被 fit 成 1x1 破坏终端。返回是否真正执行了 fit。
 */
export function makeSafeFit(
  getContainer: () => HTMLElement | null,
  fit: () => void,
): () => boolean {
  return () => {
    const el = getContainer();
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) return false;
    fit();
    return true;
  };
}
```

- [ ] **Step 2: XtermView 改用共享 util**

删 XtermView 内的 `resolveXtermTheme`/`cssVarToColor` 定义，改 `import { resolveXtermTheme, makeSafeFit } from "./xterm-shared"`。effect 内 `const safeFit = makeSafeFit(() => containerRef.current, () => fitAddon.fit());`，其余调用不变。

- [ ] **Step 3: 跑现有前端测试 + tsc + lint**

Run: `npx tsc --noEmit && npx vitest run src && npx eslint src/components/terminal/`
Expected: 全绿（纯重构，行为不变；web 终端测试仍过）。

- [ ] **Step 4: Commit**

```bash
git add src/components/terminal/xterm-shared.ts src/components/terminal/XtermView.tsx
git commit -m "refactor(terminal): 抽 xterm-shared(resolveXtermTheme/makeSafeFit) 供两终端复用"
```

---

### Task 6: 前端类型 + ipc 契约

**Files:**
- Modify: `src/types/runtime.ts`（`RuntimeProcess` 加 `interactive`）
- Modify: `src/lib/tauri/ipc.ts`（3 个 pty 方法）

**Interfaces:**
- Produces:
  - `RuntimeProcess.interactive?: boolean`
  - `ipc.runtimePtyStart(command, name, cwd) => Promise<RuntimeProcess>`
  - `ipc.runtimePtyInput(id, data) => Promise<void>`
  - `ipc.runtimePtyResize(id, cols, rows) => Promise<void>`
  - 供 Task 7/8 消费。

- [ ] **Step 1: 加类型字段**

`src/types/runtime.ts` 的 `RuntimeProcess` 加：

```ts
  /** 交互式 PTY 进程（sudo 等）：右侧渲染可输入终端而非只读日志 */
  interactive?: boolean;
```

- [ ] **Step 2: 加 ipc 方法**

`ipc.ts` 进程管理分组内加（注意：pty 命令是桌面专属，直接 `invoke`——非 `call` 双通道，web 分支不涉及）：

```ts
  /** 交互式启动：跑 PTY，返回创建的进程条目（桌面专属） */
  runtimePtyStart: (command: string, name: string, cwd: string) =>
    invoke<RuntimeProcess>("runtime_pty_start", { command, name, cwd }),
  /** 向交互 PTY 写 stdin（键入/密码） */
  runtimePtyInput: (id: string, data: string) =>
    invoke<void>("runtime_pty_input", { id, data }),
  /** 调整交互 PTY 尺寸 */
  runtimePtyResize: (id: string, cols: number, rows: number) =>
    invoke<void>("runtime_pty_resize", { id, cols, rows }),
  /** 停止交互 PTY 会话（interactive 进程 pid=0，不能走 PID kill） */
  runtimePtyKill: (id: string) =>
    invoke<void>("runtime_pty_kill", { id }),
```

（确认 `ipc.ts` 顶部已 import `invoke`；`RuntimeProcess` 已 import。）

- [ ] **Step 3: tsc + lint**

Run: `npx tsc --noEmit && npx eslint src/lib/tauri/ipc.ts src/types/runtime.ts`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/types/runtime.ts src/lib/tauri/ipc.ts
git commit -m "feat(runtime-fe): RuntimeProcess.interactive + pty ipc(start/input/resize/kill)"
```

---

### Task 7: InteractivePtyView 组件 + 接线测试

**Files:**
- Create: `src/components/terminal/InteractivePtyView.tsx`
- Create: `src/components/terminal/__tests__/InteractivePtyView.test.tsx`
- Modify: `src/i18n/locales/zh/board.json` + `src/i18n/locales/en/board.json`（退出提示等）

**Interfaces:**
- Consumes: Task 5 共享 util；Task 6 ipc；`@tauri-apps/api/event` 的 `listen`。
- Produces: `export function InteractivePtyView({ id }: { id: string }): JSX.Element`——挂载 xterm，订阅 `runtime-pty-output:<id>` 写入、`term.onData` → `ipc.runtimePtyInput`、ResizeObserver → `ipc.runtimePtyResize`、`runtime-pty-exit:<id>` → 显示退出。

- [ ] **Step 1: 写失败测试**（mock xterm + tauri event/core，验接线契约）

```tsx
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// mock xterm：不真渲染 canvas，仅捕获 onData 回调与 write 调用
const writeSpy = vi.fn();
let onDataCb: ((d: string) => void) | null = null;
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    loadAddon: vi.fn(),
    open: vi.fn(),
    write: writeSpy,
    writeln: vi.fn(),
    onData: (cb: (d: string) => void) => { onDataCb = cb; return { dispose: vi.fn() }; },
    dispose: vi.fn(),
    cols: 80, rows: 24,
  })),
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn() })) }));

// 捕获 listen 的事件名；invoke 记录调用
const listened: string[] = [];
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string) => { listened.push(name); return Promise.resolve(() => {}); },
}));
const invokeSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeSpy(...a) }));

import { InteractivePtyView } from "../InteractivePtyView";

describe("InteractivePtyView", () => {
  beforeEach(() => { listened.length = 0; onDataCb = null; invokeSpy.mockClear(); writeSpy.mockClear(); });

  it("订阅 output/exit 事件并把键入转发到 runtime_pty_input", async () => {
    render(<InteractivePtyView id="abc123" />);
    // 等 effect 内异步 listen 注册
    await Promise.resolve();
    expect(listened).toContain("runtime-pty-output:abc123");
    expect(listened).toContain("runtime-pty-exit:abc123");
    // 模拟键入 → 调 runtime_pty_input
    onDataCb?.("p");
    expect(invokeSpy).toHaveBeenCalledWith("runtime_pty_input", { id: "abc123", data: "p" });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/components/terminal/__tests__/InteractivePtyView.test.tsx`
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 实现 InteractivePtyView.tsx**

```tsx
/**
 * InteractivePtyView.tsx — 交互式 PTY 终端视图（桌面进程管理）
 *
 * 与 XtermView 结构一致（xterm + FitAddon + safeFit + 语义色主题），但传输换成 Tauri：
 *   输出：listen("runtime-pty-output:<id>") → term.write(Uint8Array)
 *   输入：term.onData → ipc.runtimePtyInput(id, data)
 *   尺寸：ResizeObserver → ipc.runtimePtyResize(id, cols, rows)
 *   退出：listen("runtime-pty-exit:<id>") → 显示 [process exited]
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ipc } from "@/lib/tauri/ipc";
import { resolveXtermTheme, makeSafeFit } from "./xterm-shared";

export function InteractivePtyView({ id, className }: { id: string; className?: string }) {
  const { t } = useTranslation("board");
  const containerRef = useRef<HTMLDivElement>(null);
  // t 经 ref 取最新，避免语言切换重挂终端
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: resolveXtermTheme(),
      fontFamily: '"JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.4,
      cursorBlink: true,
      allowProposedApi: false,
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    const safeFit = makeSafeFit(() => containerRef.current, () => fitAddon.fit());
    safeFit();

    // 键入 → stdin
    const dataDisposable = term.onData((data) => {
      void ipc.runtimePtyInput(id, data);
    });

    // 订阅输出 / 退出事件（listen 返回 Promise<Unlisten>，卸载时解绑）
    const unlisteners: UnlistenFn[] = [];
    void listen<number[]>(`runtime-pty-output:${id}`, (e) => {
      term.write(new Uint8Array(e.payload));
    }).then((un) => unlisteners.push(un));
    void listen(`runtime-pty-exit:${id}`, () => {
      term.writeln(`\r\n\x1b[2m${tRef.current("processes.pty.exited")}\x1b[0m`);
    }).then((un) => unlisteners.push(un));

    // 尺寸变化 → resize（safeFit 跳过隐藏态）
    const observer = new ResizeObserver(() => {
      if (safeFit()) void ipc.runtimePtyResize(id, term.cols, term.rows);
    });
    observer.observe(containerRef.current);
    // 初次同步一次权威尺寸
    if (safeFit()) void ipc.runtimePtyResize(id, term.cols, term.rows);

    return () => {
      observer.disconnect();
      dataDisposable.dispose();
      unlisteners.forEach((un) => un());
      term.dispose();
    };
  }, [id]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%", overflow: "hidden" }}
      aria-label="Interactive terminal"
      role="region"
    />
  );
}
```

- [ ] **Step 4: 加 i18n key**

`zh/board.json` 加 `"processes": { ..., "pty": { "exited": "[进程已退出]" } }`（合并进现有 processes 对象）；`en/board.json` 对应 `"[process exited]"`。

- [ ] **Step 5: 运行测试，确认通过 + tsc + lint**

Run: `npx vitest run src/components/terminal/__tests__/InteractivePtyView.test.tsx && npx tsc --noEmit && npx eslint src/components/terminal/InteractivePtyView.tsx`
Expected: PASS + 无错误。

- [ ] **Step 6: Commit**

```bash
git add src/components/terminal/InteractivePtyView.tsx src/components/terminal/__tests__/InteractivePtyView.test.tsx src/i18n/locales/zh/board.json src/i18n/locales/en/board.json
git commit -m "feat(runtime-fe): InteractivePtyView(Tauri 事件桥终端) + 接线测试 + i18n"
```

---

### Task 8: WorkspaceProcesses 接入交互启动 + 分支渲染

**Files:**
- Modify: `src/features/board/WorkspaceProcesses.tsx`
- Modify: `src/i18n/locales/zh/board.json` + `en/board.json`（checkbox 标签、restart 提示、stop 交互提示）

**Interfaces:**
- Consumes: Task 6 ipc（`runtimePtyStart`/`runtimePtyKill`）；Task 7 `InteractivePtyView`；`RuntimeProcess.interactive`。
- Produces: 交互启动 checkbox + 右侧对 interactive&running 进程渲染 `InteractivePtyView`、停止走 `runtimePtyKill`。

- [ ] **Step 1: 加交互 state + checkbox**

`useState` 加 `const [interactive, setInteractive] = useState(false);`。启动表单 Input 后加 checkbox（复用现有 UI 风格；若无 Checkbox 组件用原生 `<input type="checkbox">` + label，语义色）：

```tsx
<label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
  <input
    type="checkbox"
    checked={interactive}
    onChange={(e) => setInteractive(e.target.checked)}
    disabled={busy}
  />
  {t("processes.interactiveLabel")}
</label>
```

- [ ] **Step 2: startNew 分支**

```tsx
  const startNew = async () => {
    const command = cmd.trim();
    if (!command || !repoPath) return;
    setBusy(true);
    try {
      const name = command.split(/\s+/)[0] || "proc";
      if (interactive) {
        const p = await ipc.runtimePtyStart(command, name, repoPath);
        // 启动后自动选中该进程，右侧即显交互终端等待输入
        setSelected(p.name);
      } else {
        await ipc.runtimeStart(command, name, repoPath);
      }
      toast.success(t("processes.toast.startSuccess", { cmd: command }));
      setCmd("");
      await refresh();
    } catch (e) {
      toast.error(t("processes.toast.startError", { msg: String(e) }));
    } finally {
      setBusy(false);
    }
  };
```

- [ ] **Step 3: 右侧分支渲染（选中进程为交互&running → InteractivePtyView）**

在日志区：先由 `selected` 找到对应 `RuntimeProcess`，若 `interactive && status==="running"` 渲染终端，否则现有 `<pre>` 日志：

```tsx
  const selectedProc = useMemo(
    () => procs.find((p) => p.name === selected) ?? null,
    [procs, selected],
  );
  const showPtyTerminal = !!selectedProc?.interactive && selectedProc.status === "running";
```

日志区 header 下的内容：

```tsx
{showPtyTerminal ? (
  <div className="min-h-0 flex-1 overflow-hidden bg-background">
    <InteractivePtyView id={selectedProc!.id} className="size-full" />
  </div>
) : (
  /* 现有只读日志 <pre> 分支保持不变（交互进程退出后也回落此分支看 tee 日志） */
  <div ref={logScrollRef} ...>...</div>
)}
```

- [ ] **Step 4: 停止按钮对交互进程走 runtimePtyKill**

`control("stop", name)` 分支：若该进程 `interactive` 则 `await ipc.runtimePtyKill(p.id)`，否则现有 `ipc.runtimeStop(name)`。restart 对交互进程置灰或提示 `processes.interactiveNoRestart`（后端已返回错误，前端提示即可）。

- [ ] **Step 5: i18n key**

`zh/board.json` processes 内加 `"interactiveLabel": "交互式（需输入密码）"`、`"interactiveNoRestart": "交互进程请停止后重新启动"`；`en` 对应 `"Interactive (needs password)"` / `"Interactive processes: stop and restart manually"`。

- [ ] **Step 6: tsc + lint + 现有测试**

Run: `npx tsc --noEmit && npx eslint src/features/board/WorkspaceProcesses.tsx && npx vitest run src`
Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add src/features/board/WorkspaceProcesses.tsx src/i18n/locales/zh/board.json src/i18n/locales/en/board.json
git commit -m "feat(runtime-fe): 进程管理交互式启动 checkbox + 右侧 PTY 终端 + 停止走 pty_kill"
```

---

## 真机验证清单（最终 review 后手动）

1. 项目「进程」tab 勾「交互式」→ 启动 `sudo whoami` → 右侧终端出现密码提示 → 敲密码回车 → 输出 `root`，进程标 exited。
2. 输出 tee 到日志：退出后取消选中再选中（或看全局「进程」页）→ `<pre>` 能回看该次输出。
3. 非交互进程：不勾 checkbox 启动 `npm run dev` 等 → 行为与改动前完全一致（日志 `<pre>`、看门狗、PID 判活）。
4. 交互进程运行中「停止」→ 经 runtime_pty_kill 终止、终端显示已退出。
5. 切换选中进程/切 tab → 终端不串（事件名带 id）、无残留。
6. app 退出 → 无孤儿交互子进程（退出钩子 kill_all）。
7. Windows：勾交互启动 `ssh somehost` 或任意 `set /p` 提示命令 → 可输入（验证跨平台 PTY，不特指 sudo）。

## Self-Review 备注

- 覆盖 spec 全部变更文件清单：store 字段(T1)/pty registry(T2)/命令+接线(T3)/判活+restart+kill(T4)/共享 util(T5)/类型+ipc(T6)/组件+测试(T7)/UI+i18n(T8)。
- 类型一致：`runtime_pty_start/input/resize/kill` 后端签名与 ipc 方法名/参数逐一对齐（id/data/cols/rows/command/name/cwd）。
- 已知留后项（非本计划）：交互进程「历史回放」跨刷新（当前刷新页丢终端缓冲，靠 tee 日志 `<pre>` 回看）；env 注入表单（现表单不收 env，与 headless 一致）。
- ⚠️ `store::add_process` API 名以 store.rs 实际为准（Task 3 Step 1 已注明回退到 load+push+save）。
