# rework MCP Server —— 设计

> 让本地 `claude` / `codex` CLI(及任意 MCP 客户端)直接操作 rework 的看板任务与文档。
> 形态:**应用内 Rust MCP + 共享命令注册表**,打包为可分发 plugin。v1 工具集镜像现有看板+文档。

## 决策纪要(脑暴结论)

| 维度 | 决定 |
|---|---|
| v1 目标 | **可分发 plugin**(而非仅自用);跨平台、一键接入 |
| 工具集 | **镜像现有 7 个** + `list_projects`:list_projects / list_states / list_tasks / create_task / update_task / list_docs / create_doc / update_doc(无删除,安全)。加 `list_projects` 因 MCP 客户端无"当前打开项目"概念,需先发现项目 |
| server 形态 | **应用内 Rust MCP**(跑在 rework 进程内),而非独立 Node 或独立 Rust 二进制 |
| 为什么应用内 Rust | 未来要把 Rust-only 能力(`rag_search`/`sessions_timeline` 等)也开放给 CLI;应用内 = **定义一次、多道门(Tauri IPC + MCP)共用**,新增能力"写函数 + 登记一行";Node 跨进程需为每个 Rust 能力长期维护并行 HTTP API |
| 传输 | **HTTP/SSE**(固定本地端口,占用则回退并写端点文件);Codex 若仅支持 stdio,plugin 带极小 stdio↔HTTP shim(实现计划核实后定) |
| 鉴权 | 工具授权 = **PB owner-only 规则**;handler 用 **AppState 已缓存的 local-user token**(进程内,无需端点/keychain 发现);MCP 端点绑 127.0.0.1 + 可选 bearer secret |
| 分发 | Claude Code plugin(mcp 配置 + skill + 斜杠命令)+ Codex 配置片段 |

## 关键约束(既有代码事实)

- **PB 端口动态**:`pb::process::pick_free_port()` 每次启动不同,`base = http://127.0.0.1:{port}`。→ 外部进程无法硬编码;但本设计 MCP 在**进程内**,直接拿 `AppState` 的 base_url,无此问题。
- **local-user token 在 AppState**:`AppState.auth: Arc<Mutex<Option<BootstrapAuth>>>`,`BootstrapAuth { base_url, token, user_id }`(`src-tauri/src/pb/bootstrap.rs`)。
- **Rust PB client 已具备**:`src-tauri/src/pb/client.rs` `PbClient::new(base_url, token)` + `find_one(coll, filter)` / `create(coll, data)` / `patch(coll, id, data)` / `list_all(coll, fields)`。handler 复用它。
- **看板/文档 CRUD 现仅在 TS**(`src/features/ai/agent-tools.ts` executeTool + `src/lib/pb/board.ts`);Rust 侧无。→ v1 需在 Rust 实现这 7 个(镜像 TS 语义),作为注册表地基。
- **collections**(`src/lib/pb/collections.ts`):`board_projects` / `board_project_states` / `board_tasks` / `docs`。`board_tasks` 有 `rank`(number)字段,索引 `(project, state, rank)`。

## 架构总览

应用内新增 Rust 模块 `mcp`,三部分单一职责:

1. **`registry`(工具注册表)** —— `ToolDef { name: &str, description, input_schema: Value, handler }`;`handler` 形如 `async fn(args: Value, ctx: &McpCtx) -> Result<Value, String>`。注册表把 name → ToolDef 映射,提供 `list()`(返回 MCP `tools/list` 用的 schema 数组)与 `dispatch(name, args, ctx)`(执行)。这是"定义一次、多门共用"的核心:未来把已有 Rust 命令包成 `handler` 登记即可。
2. **`tools`(看板/文档 handler)** —— v1 的 7 个 handler,用 `McpCtx` 里的 `PbClient` 打 PB。纯业务逻辑,可测(dispatch + schema 校验为纯逻辑;handler 对实机 PB 验证)。
3. **`server`(MCP 传输层)** —— HTTP/SSE MCP endpoint(用 Rust MCP SDK `rmcp`,或若成熟度不足则以 axum 实现最小 MCP-over-HTTP:`initialize` / `tools/list` / `tools/call`)。绑 `127.0.0.1:47600`(默认;占用回退随机端口)。启动时把 `{ url, secret }` 写入 `app_data_dir/mcp-endpoint.json`(仅当前用户可读),供 plugin 连接器/文档发现实际地址。

`McpCtx`:轻量上下文,从 `AppState.auth` 取 `base_url + token` 构造 `PbClient`(每次调用或缓存),外加 `user_id`(create 时写 owner)。

数据流:
```
claude/codex ──MCP(HTTP tools/call)──▶ mcp::server ──▶ registry.dispatch(name,args)
                                                            │
                                                            ▼ tools::handler(args, ctx)
                                                       PbClient(base_url, local-user token)
                                                            ▼
                                                  PocketBase(rework sidecar) —— owner-only 规则强制授权
                                                            ▲
                            rework 应用 UI(pocketbase-js)───┘   ← 同一 PB;PB realtime 让 CLI 的改动实时出现在 UI
```

## v1 工具规格(镜像 TS,均作用于「当前/指定项目」)

> 与 `agent-tools.ts` 的 `TOOL_SCHEMAS` 语义一致。**区别**:MCP 客户端无"当前打开的项目"概念,故建/查类工具需显式 `project_id` 参数(TS 版隐含当前项目)。

| 工具 | 入参 | PB 操作 |
|---|---|---|
| `list_projects` | 无 | `list_all(board_projects)` → `[{id,name}]`(新增:CLI 需先知道有哪些项目;替代 TS 的隐含当前项目) |
| `list_states` | `project_id` | `list_all(board_project_states)` 过滤 project,按 sort_order → `[{id,name,category}]` |
| `list_tasks` | `project_id` | `list_all(board_tasks)` 过滤 project,按 rank → `[{id,title,state,priority,due_date}]` |
| `create_task` | `project_id, state_id, title, description?, priority?, due_date?` | 计算 rank(该 state 内 max rank + 步长,空则起始值)→ `create(board_tasks, {owner:user_id, project, state, title, rank, ...})` |
| `update_task` | `task_id, {title?/description?/priority?/state_id?/due_date?}` | `patch(board_tasks, id, patch)`(state_id → 字段 state) |
| `list_docs` | `project_id` | `list_all(docs)` 过滤 project → `[{id,title}]` |
| `create_doc` | `project_id, title, content?` | `create(docs, {owner:user_id, project, title, content})` |
| `update_doc` | `doc_id, {title?/content?}` | `patch(docs, id, patch)` |

- 所有 handler 返回结果 JSON(create/update 返回 `{ok:true, id, ...}`,list 返回数组)。
- rank 计算(`create_task` 唯一有逻辑处):取该 project+state 现有任务的 max rank,新任务 = max + STEP(如 1000);无则起始 STEP。纯函数,可测。
- **无删除工具**(与应用内工具模式一致,安全)。

## 鉴权与安全

- **授权边界 = PB owner-only 规则**(服务端强制)。handler 以 local-user token 打 PB → PB 自动只允许操作当前用户数据。create 时 `owner` 必须 = `user_id`(满足 `@request.body.owner = @request.auth.id` createRule)。
- **MCP 端点**绑 `127.0.0.1`(不对外)。生成一次性 `secret`(启动时随机)写入 `mcp-endpoint.json`;MCP server 要求客户端在 `Authorization` 头带此 secret,防同机其它进程乱调。**v1 落地此 secret**(成本低、防误触)。plugin 连接配置从端点文件取 url + secret(连接器读文件;若客户端配置不支持文件展开,则文档指导手动粘贴,或由 shim 注入)。
- rework 应用未启动 / bootstrap 未完成时,`AppState.auth` 为 None → handler 返回明确错误「rework 未就绪:请先启动 rework 应用」;MCP server 在 auth 就绪前可拒绝 `tools/call`。

## 与应用内「工具模式」共存

- 两条独立路径,互不影响:应用内工具模式(云模型 function-calling 走 TS `runAgent`/`ai_chat_tools`)不变;MCP 路径供外部 CLI。
- 都写同一 PB → 数据一致,PB realtime 让双方改动互相可见。
- **已知代价(债务)**:7 个工具的映射逻辑 v1 存在两处(TS executeTool + Rust handler)。可接受;将来可让应用内工具模式也走 Rust registry/MCP 收敛,消除重复(非 v1)。

## 分发(plugin)

- **Claude Code**:一个 rework plugin,含
  - MCP 配置:注册 rework MCP(HTTP url,来自端点文件或固定端口)+ Authorization(secret);
  - **skill**(`SKILL.md`):指导 agent「用 rework 工具管理用户的看板/文档:建任务前先 `list_projects`/`list_states`」;
  - 斜杠命令(如 `/rework-triage`:读上下文 → 建任务)。
- **Codex**:`~/.codex/config.toml [mcp_servers.rework]` 片段(命令或 url,取决于 Codex 传输支持,实现计划核实)。
- **stdio shim(条件性)**:若某客户端仅支持 stdio MCP,plugin 附带极小 shim(读端点文件 → 代理 stdio↔应用 HTTP MCP)。传输最终形态在实现计划中据 Claude/Codex 实测确定。

## 错误处理 & 测试

- handler 错误 → MCP `tools/call` 返回 `isError` 结果 + 中文信息(PB 401/未就绪 → 「rework 未就绪/未登录」;PB 校验失败 → 透传 PB 错误体,复用 `pb/client.rs` 的 `json_or_err` 语义)。
- **纯逻辑可测**:registry `dispatch`(未知工具报错、schema 必填校验)、`create_task` 的 rank 计算(空 state / 追加 / 步长)、tools/list 的 schema 组装。
- **handler 实机验证(控制器)**:对运行中的 PB 跑 create/list/patch,确认 owner-only 规则放行且数据出现在 UI。
- MCP 协议层薄(SDK/最小实现兜),重点测注册表与 handler。

## 依赖与前置

- 新增 crate:Rust MCP SDK `rmcp`(或 `axum` + 手写最小 MCP-over-HTTP,二选一在计划中定);`tokio`/`serde_json`/`reqwest` 已在。
- 复用:`pb/client.rs`、`AppState.auth`、PB collections(board/docs)。
- 应用启动流程加:MCP server 启动 + 写 `mcp-endpoint.json`(在 bootstrap/auth 就绪后)。

## 非目标(YAGNI)

- v1 不含 RAG/会话/git 等 Rust-only 工具(注册表让其后续几行接入)。
- 不做应用内工具模式向 MCP 的收敛(消除 TS/Rust 双份)。
- 不做远程/多用户、跨机 MCP、超出 localhost+secret 的鉴权。
- 不做工具的删除类操作。

## 实现计划分解(供 writing-plans)

1. `mcp::registry`(ToolDef + dispatch + list)+ 纯逻辑测试。
2. `create_task` rank 计算纯函数 + 测试。
3. `mcp::tools` 7 个 handler(用 PbClient)+ McpCtx(从 AppState.auth 构造)。
4. `mcp::server` HTTP MCP(initialize/tools/list/tools/call)+ 固定端口/回退 + 写 `mcp-endpoint.json`(含 secret)+ Authorization 校验。
5. 应用启动集成(auth 就绪后起 server)。
6. 控制器实机验证(CLI ↔ rework 全链路:list_projects → create_task → UI 出现)。
7. 分发:Claude plugin(mcp+skill+命令)+ Codex 配置;按实测定传输/shim。
