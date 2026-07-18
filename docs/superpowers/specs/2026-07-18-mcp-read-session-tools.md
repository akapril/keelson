# MCP 读会话工具 —— 设计 + 实现计划

> 给应用内 MCP server 补 3 个「读会话」工具，让外部 claude/codex 既能写工作台、也能**读你的历史会话记忆**。补全双向 MCP 护城河的另一半，并作为"跨厂商记忆账本 / 会话→commit 溯源"的共同地基。

## 决策纪要

| 维度 | 决定 |
|---|---|
| 工具集 | 3 个只读工具：`list_sessions` / `search_sessions` / `get_session`。**只读**，不加写/删会话工具（隐私原则）。 |
| 上下文注入 | **不改 `McpCtx`**。session 工具需要 `AppState.{sessions,index,reg}`，而 handler 已持 `self.app`，`self.app.state::<AppState>()` 即可拿到。board 工具继续用 `McpCtx`(PB)。 |
| 复用 | `list_sessions`→读 `state.sessions`；`search_sessions`→`search::session_backend::search`；`get_session`→`reg.by_id(provider).read_timeline()`。全部已存在、已验证。 |
| 分发 | 新 `mcp/session_tools.rs`：schema + `is_session_tool` + `dispatch_session(name,args,&AppState)`。`call_tool` 按工具名路由到 board 或 session 分发；session 工具**不推 notify**(是读)。 |
| 非目标 | 不做会话内向量检索(依赖真 embedding，缓)；不做 extract(那是 session_extract 单独功能)；不分页(limit 截断即可，YAGNI)。 |

## 关键约束（已核实的代码事实）

- `ReworkMcpHandler { app: tauri::AppHandle }`（`mcp/server.rs:54`）；`call_tool` 里 `ctx_from_state(&self.app)` 已证明能取 AppState。
- `AppState.sessions: Arc<Mutex<Vec<Session>>>`、`index: Arc<Mutex<Option<SessionIndex>>>`、`reg: ProviderRegistry`（`lib.rs`）。
- 复用函数签名（`commands/sessions.rs`）：
  - `state.sessions.lock().clone() -> Vec<Session>`
  - `crate::search::session_backend::search(&idx, &query, limit) -> Vec<SessionHit>`（index 未就绪时调用方回退空）
  - `state.reg.by_id(&provider).map(|p| p.read_timeline(&session_id)) -> Option<Vec<TimelineMessage>>`
- `Session` / `SessionHit` / `TimelineMessage` 均 `Serialize`（前端已消费）。
- 现有工具 schema 在 `registry::tool_schemas()`（8 个）；`list_tools`（server.rs:80）映射它们。dispatch 在 `tools::dispatch`。
- MCP 已 secret+localhost 鉴权（只有本机、持密钥的客户端可访问）。

## 工具设计

### `list_sessions`
- 入参：`repo_path`(可选，等于 project_path 过滤)、`limit`(可选，默认 50)。
- 返回：会话摘要数组，按 `updated_at` 倒序、截断 limit。每条 `{ session_id, provider, project_name, project_path, first_prompt, last_prompt, message_count, updated_at }`。
- 纯逻辑 `summarize_sessions(sessions, repo_path, limit) -> Vec<Value>` 可测（过滤/排序/截断/投影）。

### `search_sessions`
- 入参：`query`(必填)、`limit`(可选，默认 20)。
- 返回：`Vec<SessionHit>`（session_id/provider/role/snippet/score）。直接 `session_backend::search`，index 未就绪返回空数组 + 一句提示。

### `get_session`
- 入参：`provider`(必填，"claude"/"codex")、`session_id`(必填)。
- 返回：`Vec<TimelineMessage>`（完整 transcript）。`reg.by_id` 未知 provider → Err「未知 provider」。

## 架构改动面

1. **新增 `src-tauri/src/mcp/session_tools.rs`**：
   - `pub fn session_tool_schemas() -> Vec<ToolDef>`（复用 `registry::ToolDef`）。
   - `pub fn is_session_tool(name: &str) -> bool`。
   - `pub fn summarize_sessions(sessions: &[Session], repo_path: Option<&str>, limit: usize) -> Vec<serde_json::Value>`（纯，可测）。
   - `pub async fn dispatch_session(name: &str, args: Value, state: &AppState) -> Result<Value, String>`（锁 AppState、复用后端、投影）。
2. **`mcp/mod.rs`**：`pub mod session_tools;`。
3. **`mcp/server.rs`**：
   - `list_tools`：返回 `tool_schemas()` 追加 `session_tool_schemas()`。
   - `call_tool`：若 `session_tools::is_session_tool(&name)` → `let st = self.app.state::<AppState>(); session_tools::dispatch_session(&name, args, st.inner()).await`，成功直接返回文本，**不 notify**；否则走原 board 分支（`ctx_from_state` + `tools::dispatch` + notify）。
4. `registry::ToolDef` 已 `pub`；`opt_str`/`require_str` 复用。

## 测试

- **纯逻辑单测（session_tools.rs）**：
  - `session_tool_schemas` 含 3 个且各为 object+properties；`is_session_tool` 对 3 名 true、对 board 名/未知 false。
  - `summarize_sessions`：repo_path 过滤、updated_at 倒序、limit 截断、投影字段齐全；空输入空输出。
- **dispatch 参数校验**（tokio 测试，不触后端）：`get_session` 缺 provider/session_id 报错；`search_sessions` 缺 query 报错。
- 手测（需重建 + MCP 已装）：外部 claude 调 `search_sessions("PB 400")` → 得命中片段；`get_session` → 得 transcript。

## 实现任务（TDD，逐个提交）

### Task 1: session_tools.rs 纯逻辑 + schema
- 写 `ToolDef` 3 schema、`is_session_tool`、`summarize_sessions`，及其单测（schema 覆盖、is_session_tool、summarize 过滤/排序/截断/投影/空）。
- `cargo test --lib mcp::session_tools::` 绿。提交。

### Task 2: dispatch_session + 接线 server/mod
- `dispatch_session` 复用后端；`mod.rs` 导出；`server.rs` 的 `list_tools` 合并 schema、`call_tool` 路由 + 跳过 notify。
- dispatch 参数校验单测。`cargo check`（先杀 pocketbase）0 error；全量 `cargo test --lib mcp::` 绿。提交。

### Task 3: 广审 + 手测清单
- 独立复审 diff（安全：只读、secret 鉴权不变、未破坏 board 路径与 notify）。
- 交付手测步骤。

## 依赖与前置
- 无新 crate、无新前端。纯 Rust。需 `cargo build` 重建 app 才能被外部 CLI 调用。
- 可选后续：给 `create_task` MCP 入参补 `source_session_id`/`source_anchor`（护城河产出物可回跳，独立小改）。

## 非目标（YAGNI）
- 不分页、不做会话内语义检索、不加写/删会话工具、不在本功能内做 extract。
