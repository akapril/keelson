# 本地运行时面板（S4）设计文档

> 状态：设计已与用户确认，待 review。
> 属 agent-中心 IA 蓝图的 **S4**（见 [[rework-agent-centric-ia-direction]]）。接已合 master 的 S1（队列）+ S2（命名队友）+ S3（Inbox 决策）。
> 目标：把 `/processes` 进程页升格为「运行时」——一张"本地运行时"卡展示机器资源 + agent 容量 + 健康/时长 + 磁盘，下方保留托管进程列表。Multica 的 Runtimes 概念在单机本地的务实落地（云 runtime 留后）。

## 目标

给 `/processes` 页顶部加一张"本地运行时"状态卡，聚合展示：机器 CPU/内存、agent 容量（在跑 vs 全局上限）、运行时健康 + 运行时长、磁盘占用。页与侧栏项正名「运行时」。回答"我的机器现在多忙、还能不能再派 agent"。

## 决策（已确认）

1. **MVP = 本地运行时容量面板**：不建多运行时抽象；单机本地。
2. **运行时卡四区全做**：机器资源(CPU/内存) + agent 容量(在跑/上限) + 健康/时长 + 磁盘占用。
3. **正名 = 页 + 侧栏都改「运行时」**；路由**保留 `/processes`**（不破深链）。
4. **一个 `runtime_status` 命令聚合全部**（前端一次拉齐 + 轮询）。
5. **CPU/磁盘走 `spawn_blocking`** 防阻塞 UI。
6. **agent 容量只显计数**，不单列在跑 agent 明细（归 Inbox，不重复）。
7. **磁盘只显占用**，不做清理动作。

## 现状基线

- `/processes` → `src/pages/processes.tsx`：标题 + `<WorkspaceProcesses/>`（全局模式，列所有托管进程 + 日志/停止/重启/删除）。路由 `/processes`。
- 侧栏 System 组「进程」项（`navigation.ts`，`nav.processes.*` → `/processes`）。
- `runtime/` 模块：`sysmon.rs`（sysinfo `System` 全局 `SYS: OnceLock<Mutex<System>>`；`usage(pid)->(mem,cpu)`；CPU 基于两次刷新差值，首次为 0）、`resources.rs`（`ResourceUsage`/`format_bytes`）、`health.rs`、`store.rs`（`ProcessEntry`/`load_processes()`/`runtime_dir()`）。
- `sysinfo = "0.38.4"`（Cargo.toml）；`System` 有 `global_cpu_usage()`（需 `refresh_cpu_all` + 两次采样）/`total_memory()`/`used_memory()`（需 `refresh_memory`）。
- `agent/worker.rs:11`：`pub const AGENT_CONCURRENCY_GLOBAL_CAP: usize = 8;`（S2）。
- `agent_runs` 集合（S1/S2）：status running/review/blocked/…；owner-only。
- `commands/agent.rs:19`：`fn make_client(&State<AppState>) -> Result<(PbClient, String), String>`（私有；读 `state.auth` 克隆 base_url/token/user_id）。
- `commands/runtime.rs`：`runtime_command` 分发器（现有）。命令在 `lib.rs` `generate_handler!` 注册。
- `AppState`（lib.rs）：`.manage(AppState::default())`；无 `started_at`。
- PB 数据目录 = `app_data_dir()/pb_data`；运行时目录 = `runtime::store::runtime_dir()`（`~/.claude-runtime` 等价）；项目 worktree = `<repo>/.worktrees`。

## A. 后端

### A1. 机器资源（`runtime/sysmon.rs` 加）

```rust
/// 机器级 CPU% 与内存（used/total 字节）。CPU 需两次采样差值：
/// 复用全局 SYS，refresh_cpu_all → 睡 sysinfo::MINIMUM_CPU_UPDATE_INTERVAL → 再 refresh_cpu_all 取 global_cpu_usage。
/// 调用方应在 spawn_blocking 里跑（含 ~200ms 睡眠）。
pub fn system_usage() -> (f32, u64, u64) // (cpu_percent, mem_used, mem_total)
```
用 `sys.refresh_memory()` 取 `used_memory()`/`total_memory()`；CPU 用 `refresh_cpu_all()` 两次（间隔 `sysinfo::MINIMUM_CPU_UPDATE_INTERVAL`）后 `global_cpu_usage()`。

### A2. 磁盘占用（新 `runtime/disk.rs`）

```rust
/// 递归求目录字节数（符号链接不跟随；无法读的项跳过）。
pub fn dir_size(path: &std::path::Path) -> u64
/// 运行时数据总占用 = pb_data + runtime_dir + 各项目 .worktrees（best-effort，缺失/失败计 0）。
pub fn runtime_disk_bytes(pb_data: &Path, repos: &[PathBuf]) -> u64
```
调用方在 `spawn_blocking` 里跑。repos 从 board_projects 的 repo_path 收集（前端传入或后端查 PB——见 A4 决定：为简单，S4 只算 `pb_data + runtime_dir`，worktrees 汇总留后不做，避免跨项目扫盘慢）。**修正 §决策：磁盘 MVP 只算 pb_data + runtime_dir**（worktrees 分散在各 repo、扫描慢，YAGNI）。

### A3. uptime

`AppState` 加 `started_at: std::time::Instant`（`AppState::default()` 里 `Instant::now()`）。命令返回 `uptime_secs = started_at.elapsed().as_secs()`。（Tauri 运行时可用 Instant；非工作流环境，无 Date::now 限制。）

### A4. agent 容量 + 健康

- `agent_running`：命令内读 `state.auth` 构造 `PbClient`（复刻 make_client 逻辑，或将其提为 `pub(crate)` 复用），查 `agent_runs` `status = "running" && deleted_at = ""` 计数。auth 未就绪 → 计 0。
- `agent_cap` = `crate::agent::worker::AGENT_CONCURRENCY_GLOBAL_CAP`。
- `pb_ok`：best-effort（auth 就绪且计数查询成功即 true；失败 false）。
- `proc_count` = `runtime::store::load_processes()` 中 status=="running" 计数。

### A5. 聚合命令（`commands/runtime.rs` 加）

```rust
#[derive(serde::Serialize)]
pub struct RuntimeStatus {
    pub cpu_percent: f32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub mem_display: String,      // 如 "5.2 GB / 16 GB"
    pub agent_running: u32,
    pub agent_cap: u32,
    pub uptime_secs: u64,
    pub disk_bytes: u64,
    pub disk_display: String,     // 如 "1.3 GB"
    pub pb_ok: bool,
    pub proc_count: u32,
}

#[tauri::command]
pub async fn runtime_status(state: State<'_, AppState>) -> Result<RuntimeStatus, String>
```
命令内：`tokio::task::spawn_blocking` 跑 `system_usage()` + `runtime_disk_bytes()`（阻塞/睡眠）；async 部分查 agent_running。组装返回。`mem_display`/`disk_display` 用 `resources::format_bytes`。
在 `lib.rs` `generate_handler!` 注册 `commands::runtime::runtime_status`。

## B. 前端

### B1. 运行时状态卡（新 `src/features/runtime/RuntimeStatusCard.tsx`）

- 一张卡四区：
  - **健康/时长**：绿点「运行中」+ `formatUptime(uptime_secs)`（"运行 3h 12m"）+ PB 可达点（pb_ok）。
  - **机器资源**：CPU% 进度条 + 内存 `mem_display` 进度条（used/total 比例）。
  - **agent 容量**：`capacityLabel(agent_running, agent_cap)`（"3 / 8 agent 在跑"）；满时红字"已达上限，新指派将排队"（呼应 S2 队列）。
  - **磁盘**：`disk_display`（运行时数据占用）。
- 轮询：挂载 + 每 3s `ipc.runtimeStatus()` 刷新（CPU 活值）；卸载清 interval；失败静默（显 "—" 占位，不 toast）。
- 纯函数 `src/features/runtime/runtime-format.ts`：`formatUptime(secs)`、`capacityLabel(running, cap)`、`memBarPercent(used,total)` 配 vitest。

### B2. `/processes` 页正名（`src/pages/processes.tsx`）

- 标题改 `t("shell:runtime.title")`（运行时）+ 副标题 `runtime.description`。
- 顶部渲染 `<RuntimeStatusCard/>`；下方 `<WorkspaceProcesses/>`（加区块小标题"托管进程"）。
- 路由**保持 `/processes`**。

### B3. 侧栏正名（`src/lib/navigation.ts`）

- System 组「进程」项：`titleKey` → `nav.runtime.title`、`descriptionKey` → `nav.runtime.description`、图标换（如 `Cpu`/`DatabaseIcon`——实现时确认 hugeicons 名存在，tsc 兜底回退现图标）、`url` 保持 `/processes`。

### B4. 类型 / ipc

- `src/types/runtime.ts` 加 `RuntimeStatus` 接口（对齐 Rust 字段）。
- `src/lib/tauri/ipc.ts` 加 `runtimeStatus(): Promise<RuntimeStatus>` = `call("runtime_status")`。

### B5. i18n

- `shell` ns：`nav.runtime.title`（运行时/Runtime）、`nav.runtime.description`、`runtime.title`、`runtime.description`、运行时卡各标签（健康/运行中/CPU/内存/agent 容量/满载提示/磁盘/运行时长）。zh/en 一致。

## C. 明确不做（YAGNI / 边界）

- 多运行时 / 云 runtime / 机器路由（蓝图留后）。
- 单列在跑 agent 明细（归 Inbox）。
- worktrees 磁盘汇总（分散慢，MVP 只算 pb_data + runtime_dir）。
- 历史资源曲线 / 监控告警（只显当前值）。
- 磁盘清理动作（PB 清日志另有入口）。
- 进程列表功能改动（stop/restart/logs 不动）。
- 侧栏三组重排（S5）——S4 只正名「进程→运行时」这一项。

## D. 约束（继承全局）

- 复用 `runtime`/`resources::format_bytes`/`WorkspaceProcesses`/S2 GLOBAL_CAP，不重写。
- CPU/磁盘阻塞操作走 `spawn_blocking`（不冻 UI，参照 [[rework-tauri-sync-command-blocks-ui]]：重活命令 async）。
- TDD：前端纯函数（formatUptime/capacityLabel/memBarPercent）先写失败测试。Rust 集成靠 cargo check + CI（Windows 本地 cargo test 0xc0000139）。
- 中文注释；不硬编码（轮询间隔/上限用常量）。
- 子进程/系统调用走 `crate::proc::hidden_*` 若涉及（本设计 sysinfo 纯 Rust，无 spawn）。
- notification source 无关；tsc 通过。
- 提交不加 `Co-Authored-By: Claude` 尾注。

## E. 测试

- 前端纯函数 `formatUptime`/`capacityLabel`/`memBarPercent` vitest。
- Rust：`system_usage`/`dir_size` 编译 + CI；`format_bytes` 已有。
- 集成：GUI 点验卡显示资源/容量/磁盘、3s 刷新、满容量红字提示、uptime 递增。

## 分期

单一实现计划。任务顺序建议：①Rust `system_usage`(sysmon) + `dir_size`/`runtime_disk_bytes`(disk.rs)；②`AppState.started_at` + `runtime_status` 命令(聚合 + spawn_blocking + agent 计数) + lib.rs 注册；③前端类型 + ipc + `runtime-format.ts` 纯函数(+测)；④`RuntimeStatusCard` 组件(轮询/四区)；⑤`/processes` 页正名 + 挂卡 + 侧栏/i18n。
