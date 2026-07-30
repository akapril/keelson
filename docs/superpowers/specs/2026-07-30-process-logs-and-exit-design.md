# 进程日志动作 + 退出行为设计

> 状态：设计已确认（2026-07-30）。日志=「打开文件 + 复制可见」；退出=C（设置默认 + 每次询问）。

## A. 日志动作（打开文件 + 复制可见）

日志区顶栏（`WorkspaceProcesses` 非 PTY 分支，与「清空」并列）加两个按钮：

- **复制**：`navigator.clipboard.writeText(selectedLogs.join("\n"))` + toast。纯前端；复制**当前可见尾部**（全量走「打开」）。
- **打开**：调 `ipc.runtimeOpenLog(name)` → 后端 `handle_open_log`：`find_process` → `<id>.log` → 用**系统默认程序**打开：
  - Windows `cmd /C start "" "<path>"`（`explorer <file>` 只开文件夹，故用 start 开文件）
  - macOS `open "<path>"`；Linux `xdg-open "<path>"`
  - 文件不存在 → 返回错误 toast。
- dispatch 加 `"open_log"`；ipc 加 `runtimeOpenLog`。
- i18n：`copyLogs`/`copyLogsSuccess`/`copyLogsError`/`openLog`/`openLogError`。

## B. 退出行为（C：设置默认 + 可选每次询问）

### 现状（已确认）
- headless 受管进程 `mem::forget` + 独立进程组 → **关程序后仍后台运行**，processes.json 持久化，下次打开继续管理（PID 判活）。这是默认。
- 交互 PTY / PB sidecar：`RunEvent::Exit` 已 kill（本设计不动）。
- 关主窗口 = 隐藏到托盘（不退）；仅托盘「退出」= `app.exit(0)`（lib.rs:257）才真退。

### 设计
- **config**（config.rs）加 `on_exit_processes: String`，取值 `"keep"|"kill"|"ask"`，默认 `"keep"`（`#[serde(default = "default_on_exit")]`）。
- **kill_all_managed()**（runtime，新）：遍历 `store::load_processes()` 中 `status=="running"` 的条目，逐个平台 kill（Windows `taskkill /PID /T /F`；unix `kill -TERM`），并 `update_process(status="stopped")`。仅管 headless 受管进程（交互 PTY 归 web/runtime_pty 的 kill_all）。
- **托盘 quit 分支**（lib.rs `"tray_quit"` handler）：读 `config.on_exit_processes`：
  - `"keep"` → `app.exit(0)`（现状）。
  - `"kill"` → `kill_all_managed()` → `app.exit(0)`。
  - `"ask"` → 若有 running 受管进程：`show_main(app)` + `app.emit("confirm-exit", ())`，**不退**，交前端弹窗决定；无 running 进程则直接 `app.exit(0)`。
- **exit_app(app, kill: bool)** Tauri 命令：`if kill { runtime::kill_all_managed() }` → `app.exit(0)`。供前端弹窗的两个选择调用。
- **config getter/setter**（commands/config.rs）：`config_get_exit_behavior` / `config_set_exit_behavior`（持久化到 config.toml，同 hotkey 范式），注册进 handler。
- **前端**：
  - `ExitConfirmDialog`（挂在主应用外壳，如 dashboard-layout）：`listen("confirm-exit")` → 弹 `AlertDialog`「全部结束 / 保留后台 / 取消」→ 分别 `ipc.exitApp(true)` / `ipc.exitApp(false)` / 关闭。
  - `ProcessExitSection`（设置页）：下拉 keep/kill/ask，读写 config 命令；i18n。
- **ipc**：`exitApp(kill)`、`configGetExitBehavior`、`configSetExitBehavior`。
- i18n（settings + 弹窗文案）zh/en。

### 边界
- `ask` 且前端未响应（异常）：不退（安全，宁可不退也不误杀/误留）。用户可再点退出。
- kill_all_managed 只 kill running；已 stopped/exited 不动。
- 与 `RunEvent::Exit`（kill pb/web_pty/runtime_pty）不冲突：那些是 app 自身附属，恒清；本设计只加「headless 受管进程」的可选清理。

## 非目标
- 不做全局「全部停止」批量按钮（本次；可后续）。
- 日志不做「下载/另存为」（打开文件后从编辑器另存即可）。

## 测试
- 后端 spawn/kill/open 属 IO，Windows 本机 cargo test 受限 → cargo check + CI + 真机。
- config `on_exit_processes` serde 默认值可单测（同 web_autostart 范式）。
- 真机：①日志「复制」进剪贴板、「打开」用编辑器开全量；②设置 keep/kill/ask 三态：keep 退出后进程仍在、kill 退出即结束、ask 退出弹窗按选择执行；③关窗仍只隐藏。

## 变更文件
- `src-tauri/src/runtime/daemon.rs`（handle_open_log + dispatch）
- `src-tauri/src/runtime/mod.rs` 或 daemon（kill_all_managed）
- `src-tauri/src/config.rs`（on_exit_processes 字段）
- `src-tauri/src/commands/config.rs`（exit_behavior getter/setter）
- `src-tauri/src/commands/fs.rs` 或新（exit_app 命令）
- `src-tauri/src/lib.rs`（托盘 quit 分支 + 注册命令）
- `src/lib/tauri/ipc.ts`（runtimeOpenLog/exitApp/config exit behavior）
- `src/features/board/WorkspaceProcesses.tsx`（复制/打开按钮）
- 新 `src/features/settings/ProcessExitSection.tsx` + 挂进 settings 页
- 新 `src/components/ExitConfirmDialog.tsx` + 挂进主外壳
- `src/i18n/locales/{zh,en}/{board,settings}.json`
