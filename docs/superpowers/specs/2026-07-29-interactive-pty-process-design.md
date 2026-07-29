# 交互式 PTY 进程（sudo 密码）设计

> 状态：设计已确认（2026-07-29）。用户选定：内嵌右侧日志区的交互终端；Tauri 事件桥；看门狗关；tee 日志；跨平台。

## 问题

桌面「进程管理」手动启动进程走 headless 路径（`runtime/daemon.rs::handle_start`）：`sh -c "<命令>"` / `cmd /C`，stdout/stderr 重定向到日志文件，`std::mem::forget(child)`，无 stdin、无 TTY。

因此任何需要交互输入的命令都无法工作。典型是 `sudo`：它在控制终端上提示密码，headless 无 TTY → 直接 `sudo: no tty present` 失败，或挂起等一个永远等不到的输入。ssh 首次指纹确认、任何 `read` 密码提示同理。

**这不是配置问题，是架构缺口**：现有模型根本没有把交互 I/O 接到前端的通道。

## 目标

在进程管理里增加一条**交互式启动**路径：进程跑在 PTY 中，前端内嵌一个可输入的 xterm 终端，用户在里面直接敲 sudo 密码（或应答任何提示）。启动通过后，进程照旧受管（列表/日志/停止/重启），输出同时落日志文件保持一致体验。

**非目标（YAGNI）**
- 不做密码存储/记忆（每次交互输入，绝不落盘）。
- 不改 headless 路径的默认行为（非交互进程完全不受影响）。
- 不做 Windows UAC 提权（那是 OS 层弹窗，喂不进密码，与 sudo 是两回事）。
- 不做交互进程的看门狗自动重启（重启会再次索要密码，无人值守无意义）。

## 架构

**传输：Tauri 事件桥（非 WebSocket）。** 桌面本地场景不该被迫开 web gateway。复用 `portable-pty`（web 端已在用），在 runtime 内新增交互 PTY 模块，输出经 Tauri `emit` 推给前端，输入/尺寸经新 Tauri 命令回传。

```
前端 InteractivePtyView (xterm.js)
   │  键入/尺寸                     ▲ 输出字节
   ▼  invoke                        │ listen("runtime-pty-output:<id>")
runtime_pty_input / _resize    Tauri emit
   │                                ▲
   ▼                                │
InteractivePtyRegistry (portable-pty)  ── reader 线程 ─┐
   │ 同时 tee                                          │
   ▼                                                   │
日志文件 (stdout_dir/<id>.log) ←──────────────────────┘
```

### 后端

**新模块 `src-tauri/src/runtime/pty.rs`：`InteractivePtyRegistry`**
- 会话表 `HashMap<String /*进程 id*/, InteractivePtySession>`，`parking_lot::Mutex`，全局单例（`OnceLock<Arc<...>>`，与 web `PtyRegistry` 独立——那个只跑 provider CLI argv，本模块跑任意 shell 命令）。
- `open(app, id, command, cwd, env)`：
  1. `native_pty_system().openpty(80x24)`。
  2. **跑任意命令经 shell**（与 headless 路径同壳，保证命令语义一致）：unix `sh -c <command>`；windows `cmd /C chcp 65001>nul && <command>`。command 是**单一 argv 元素**传给 `sh -c`（不是把用户输入拼进 shell 字符串的多段），与现有 `handle_start` 完全一致的信任模型——桌面手动启动本就允许任意本机命令，非 web 攻击面。
  3. `cwd(cwd)`、注入 env。
  4. spawn 到 slave，取 writer。
  5. 起 `spawn_blocking` reader 线程：循环 `read` → ① `app.emit("runtime-pty-output:<id>", bytes)` ② 追加写日志文件（tee）。EOF/错误 → emit `runtime-pty-exit:<id>` + 更新进程表 status=exited + 清理会话。
- `input(id, bytes)`：写 PTY writer + flush。
- `resize(id, cols, rows)`：`master.resize`。
- `kill(id)`：kill + wait 收尸 + 移除。
- `Drop`：清场所有残留（杜绝孤儿）。
- 复用 `web/terminal.rs` 已验证的 reader-线程 + mpsc/emit 模式与收尸逻辑（此处 emit 取代 WS 发送）。

**新 Tauri 命令（`commands/runtime.rs` 旁增，因需 `AppHandle` 注入——`dispatch` 无 AppHandle）**
- `runtime_pty_start(app, command, name, cwd, env) -> Result<RuntimeProcess, String>`：
  - 校验 name 冲突（复用 `store::find_process`）。
  - 生成 6 位 id，建日志文件。
  - `registry.open(app, id, command, cwd, env)`。
  - 写 `ProcessEntry`（status=running，**max_restarts=0 强制**，标记 `interactive=true`），返回条目。
- `runtime_pty_input(id: String, data: String) -> Result<(), String>`。
- `runtime_pty_resize(id: String, cols: u16, rows: u16) -> Result<(), String>`。
- 三者在 `lib.rs` 的 `invoke_handler![...]` 注册。

**`ProcessEntry` 加字段 `interactive: bool`**（`#[serde(default)]` 兼容旧记录）。stop/restart/remove/判活/清理逻辑对交互进程沿用现有（kill 用 PID）；仅：
- 看门狗：`interactive` 进程不起看门狗（`handle_start` 里 max_restarts 已 0，pty 路径本就不接看门狗）。
- restart：交互进程的 restart 语义 = 停止后需用户重新交互启动（restart 直接停止并提示「交互进程请重新启动」，不自动重跑；避免无 TTY 重跑再次卡死）。

**stop/exit 时** emit `runtime-pty-exit:<id>`，前端终端显示 `[process exited]`。

### 前端

**`src/components/terminal/InteractivePtyView.tsx`**（新）
- 结构镜像 `XtermView`（xterm + FitAddon + safeFit + 主题 + ResizeObserver），但**传输换成 Tauri**：
  - 输出：`on("runtime-pty-output:" + id, (bytes) => term.write(bytes))`。
  - 输入：`term.onData(data => ipc.runtimePtyInput(id, data))`。
  - 尺寸：ResizeObserver → `ipc.runtimePtyResize(id, cols, rows)`。
  - 退出：`on("runtime-pty-exit:" + id, () => term.writeln("[process exited]"))`。
- 复用 `resolveXtermTheme`/`safeFit`：从 `XtermView.tsx` 抽到共享 `src/components/terminal/xterm-shared.ts`（DRY），两个终端组件都 import。

**`WorkspaceProcesses.tsx` 改动**
- 启动表单加 checkbox「交互式（需输入密码）」state `interactive`。
- `startNew`：`interactive` 为真 → `ipc.runtimePtyStart(command, name, repoPath)`；否则原 `ipc.runtimeStart`。
- 右侧日志区：选中进程 `p.interactive && p.status==="running"` → 渲染 `<InteractivePtyView id={p.id} />`（可输入）；否则渲染现有只读日志 `<pre>`（含交互进程已退出后回看 tee 日志）。

**`ipc.ts`** 加：
```ts
runtimePtyStart: (command, name, cwd) => invoke<RuntimeProcess>("runtime_pty_start", { command, name, cwd }),
runtimePtyInput: (id, data) => invoke<void>("runtime_pty_input", { id, data }),
runtimePtyResize: (id, cols, rows) => invoke<void>("runtime_pty_resize", { id, cols, rows }),
```
（PTY 命令是桌面专属，走 invoke；web 分支不涉及。）

**`types/runtime.ts`** `RuntimeProcess` 加 `interactive?: boolean`。

**i18n**：`board` namespace 加交互 checkbox 标签、终端退出提示、restart 交互进程提示等，zh/en 双语。

## 跨平台

- PTY 路径 unix/windows 皆可（`portable-pty` 已跨平台，web 端已验证）。
- `sudo` 是 unix 语义。Windows 无 sudo（UAC 另说），但交互 PTY 对 Windows 的 ssh/WSL sudo/任意密码提示同样有用——功能不做平台限制，只是 sudo 特指 unix。

## 安全

- 交互 PTY 跑任意本机命令：与现有 headless 手动启动**同一信任模型**（桌面本地用户，非 web 入口）。command 作 `sh -c` 的单一参数，不引入新的拼接注入面。
- 密码：仅经 PTY stdin 实时透传，**不进日志 tee**（sudo 回显本就关闭；即便应用层也不额外记录 input）。绝不落盘、不入进程表 command 字段（command 是启动命令，不含运行时输入）。
- 事件命名带 id（`runtime-pty-output:<id>`）避免串扰；前端只订阅自己那路。

## 测试

- 后端纯函数/可 standalone 测：命令构建（sh -c 参数化）、日志 tee 路径拼接、interactive 进程 max_restarts 强制 0 的逻辑。
- PTY spawn/IO 属集成，靠 CI（ubuntu）+ 手动真机验证（Windows 本地 `cargo test --lib` 有 0xc0000139 限制，见记忆 rework-windows-cargo-test-lib）。
- 前端：InteractivePtyView 的 Tauri 事件接线用 mock 单测（listen/invoke mock），断言输出写入、输入回传、退出提示。
- 真机验证清单：① 交互启动 `sudo whoami` → 终端提示密码 → 敲入 → 成功；② 输出 tee 到日志、退出后 `<pre>` 可回看；③ 非交互进程完全不受影响；④ 切进程/切 tab 终端不串。

## 变更文件清单

- 新增 `src-tauri/src/runtime/pty.rs`（InteractivePtyRegistry）
- 新增 `src-tauri/src/commands/runtime_pty.rs`（3 命令）
- 改 `src-tauri/src/runtime/store.rs`（ProcessEntry 加 interactive 字段）
- 改 `src-tauri/src/runtime/mod.rs`（导出 pty；全局 registry 初始化）
- 改 `src-tauri/src/lib.rs`（注册 3 命令 + registry 初始化）
- 改 `src-tauri/src/runtime/daemon.rs`（interactive 进程 restart 语义；已 max_restarts=0）
- 新增 `src/components/terminal/InteractivePtyView.tsx`
- 可能新增 `src/components/terminal/xterm-theme.ts`（抽共享主题/safeFit，DRY）
- 改 `src/features/board/WorkspaceProcesses.tsx`（checkbox + 分支渲染）
- 改 `src/lib/tauri/ipc.ts`（3 个 ipc 方法）
- 改 `src/types/runtime.ts`（interactive 字段）
- 改 `src/i18n/locales/{zh,en}/board.json`（文案）
