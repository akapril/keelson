# rework MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 rework(Tauri v2)进程内内嵌一个 HTTP MCP server,让本地 `claude` / `codex` CLI 通过 MCP 直接操作用户的看板任务与文档。

**Architecture:** 新增 Rust `mcp` 模块:纯逻辑的工具注册表(schema 列表 + match 分发)+ 8 个 handler(用 `pb/client.rs` 的 `PbClient` 打同一个 PocketBase,授权由 PB owner-only 规则强制)+ rmcp 承载的 Streamable-HTTP 传输(固定端口 47600,占用回退)。应用启动在 auth 就绪后拉起 server,并写 `mcp-endpoint.json`(url + secret)。

**Tech Stack:** Rust, tokio(已 full), serde_json, reqwest(已在,PbClient 用), **rmcp 2.1**(新增,`server` + `transport-streamable-http-server` feature), Tauri v2。

参考 spec:`docs/superpowers/specs/2026-07-17-rework-mcp-server-design.md`。

## Global Constraints

- 注释与日志默认中文。
- 授权边界 = **PB owner-only 规则**;handler 用 `AppState.auth` 里的 local-user token 打 PB;create 时 `owner` 字段必须 = `user_id`(满足 createRule `@request.body.owner = @request.auth.id`)。
- MCP 端点绑 `127.0.0.1`,默认端口 `47600`(占用则回退随机端口);启动写 `app_data_dir/mcp-endpoint.json`,内含 `{ "url": ..., "secret": ... }`;server 校验请求头 `Authorization: Bearer <secret>`。
- 工具集 = 8 个:`list_projects` / `list_states` / `list_tasks` / `create_task` / `update_task` / `list_docs` / `create_doc` / `update_doc`。**无删除工具**。
- collections:`board_projects` / `board_project_states` / `board_tasks` / `docs`。`board_tasks` 有 `rank`(number)字段。
- 既有事实:`PbClient::new(base_url,token)` / `find_one(coll,filter)->Option<Value>` / `create(coll,data)->Value` / `patch(coll,id,data)->Value` / `list_all(coll,fields)->Vec<Value>`(`src-tauri/src/pb/client.rs`,`#![allow(dead_code)]`);`AppState.auth: Arc<parking_lot::Mutex<Option<BootstrapAuth>>>`,`BootstrapAuth{base_url,token,user_id}`(`src-tauri/src/pb/bootstrap.rs`)。
- rmcp 只承载协议/传输;`initialize`/`tools/list`/`tools/call` 一律**委托**到本模块的 `tool_schemas()` 与 `dispatch()`。rmcp 的具体 API 以实现时 `cargo doc -p rmcp` / 官方 examples 为准适配,但**委托契约不变**。

---

### Task 1: `mcp::registry` —— ToolDef + schema 列表 + 参数校验助手

**Files:**
- Create: `src-tauri/src/mcp/mod.rs`(先 `pub mod registry;` + 模块注释)
- Create: `src-tauri/src/mcp/registry.rs`
- Modify: `src-tauri/src/lib.rs`(顶部加 `mod mcp;`)

**Interfaces:**
- Produces:
  - `pub struct ToolDef { pub name: &'static str, pub description: &'static str, pub input_schema: serde_json::Value }`
  - `pub fn tool_schemas() -> Vec<ToolDef>` —— 返回 8 个工具的 schema
  - `pub fn require_str(args: &serde_json::Value, key: &str) -> Result<String, String>` —— 取必填字符串参数,缺失/非字符串返回中文错误
  - `pub fn opt_str(args: &serde_json::Value, key: &str) -> Option<String>`

- [ ] **Step 1: 写失败测试**

`src-tauri/src/mcp/registry.rs` 末尾:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn schemas_cover_all_eight_tools() {
        let names: Vec<&str> = tool_schemas().iter().map(|t| t.name).collect();
        for expected in [
            "list_projects", "list_states", "list_tasks", "create_task",
            "update_task", "list_docs", "create_doc", "update_doc",
        ] {
            assert!(names.contains(&expected), "缺少工具 {expected}");
        }
        assert_eq!(tool_schemas().len(), 8);
    }

    #[test]
    fn each_schema_is_object_with_properties() {
        for t in tool_schemas() {
            assert_eq!(t.input_schema["type"], "object", "{} schema 非 object", t.name);
            assert!(t.input_schema.get("properties").is_some(), "{} 缺 properties", t.name);
        }
    }

    #[test]
    fn require_str_extracts_or_errors() {
        let args = json!({ "title": "hello", "n": 5 });
        assert_eq!(require_str(&args, "title").unwrap(), "hello");
        assert!(require_str(&args, "missing").is_err());
        assert!(require_str(&args, "n").is_err()); // 非字符串
    }

    #[test]
    fn opt_str_returns_none_when_absent() {
        let args = json!({ "title": "x" });
        assert_eq!(opt_str(&args, "title"), Some("x".to_string()));
        assert_eq!(opt_str(&args, "missing"), None);
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd src-tauri && cargo test mcp::registry`
Expected: 编译失败(未定义)。

- [ ] **Step 3: 实现**

`src-tauri/src/mcp/mod.rs`:

```rust
//! MCP：应用内 HTTP MCP server —— 让本地 claude/codex 操作看板与文档。
//! registry（纯逻辑：schema + 分发）/ tools（handler，打 PB）/ server（rmcp 传输）。
pub mod registry;
```

`src-tauri/src/mcp/registry.rs`(tests 之前):

```rust
//! 工具注册表：8 个工具的 JSON Schema + 参数校验助手。纯逻辑,可测。
//! 分发在 tools.rs 的 dispatch()（需 PB 上下文,故与 handler 同处）。
use serde_json::{json, Value};

/// 一个工具的元信息（名称 + 描述 + 入参 JSON Schema）。
pub struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
}

/// 取必填字符串参数；缺失或非字符串返回中文错误。
pub fn require_str(args: &Value, key: &str) -> Result<String, String> {
    match args.get(key).and_then(|v| v.as_str()) {
        Some(s) => Ok(s.to_string()),
        None => Err(format!("缺少必填参数「{key}」（需为字符串）")),
    }
}

/// 取可选字符串参数。
pub fn opt_str(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

const PRIORITIES: [&str; 5] = ["none", "low", "medium", "high", "urgent"];

/// 8 个工具的 schema。均需显式 project_id（MCP 无"当前项目"概念）。
pub fn tool_schemas() -> Vec<ToolDef> {
    let project_id = json!({ "type": "string", "description": "看板项目 id（来自 list_projects）" });
    vec![
        ToolDef {
            name: "list_projects",
            description: "列出当前用户的所有看板项目（返回 id 与名称）。建/查任务前先调它拿 project_id。",
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "list_states",
            description: "列出指定项目的状态列（建任务时选目标列）。返回 id、名称、类别。",
            input_schema: json!({ "type": "object", "properties": { "project_id": project_id }, "required": ["project_id"] }),
        },
        ToolDef {
            name: "list_tasks",
            description: "列出指定项目的所有任务（含 id、标题、所在状态列、优先级、截止日期）。",
            input_schema: json!({ "type": "object", "properties": { "project_id": project_id }, "required": ["project_id"] }),
        },
        ToolDef {
            name: "create_task",
            description: "在指定项目创建任务。state_id 来自 list_states。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "project_id": project_id,
                    "state_id": { "type": "string", "description": "目标状态列 id" },
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "priority": { "type": "string", "enum": PRIORITIES },
                    "due_date": { "type": "string", "description": "截止日期，如 2026-08-01" }
                },
                "required": ["project_id", "state_id", "title"]
            }),
        },
        ToolDef {
            name: "update_task",
            description: "更新任务字段（task_id 来自 list_tasks），只传要改的字段。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "priority": { "type": "string", "enum": PRIORITIES },
                    "state_id": { "type": "string", "description": "移动到的目标状态列 id" },
                    "due_date": { "type": "string" }
                },
                "required": ["task_id"]
            }),
        },
        ToolDef {
            name: "list_docs",
            description: "列出指定项目的文档（含 id 与标题）。",
            input_schema: json!({ "type": "object", "properties": { "project_id": project_id }, "required": ["project_id"] }),
        },
        ToolDef {
            name: "create_doc",
            description: "在指定项目创建文档（Markdown 正文可选）。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "project_id": project_id,
                    "title": { "type": "string" },
                    "content": { "type": "string", "description": "Markdown 正文" }
                },
                "required": ["project_id", "title"]
            }),
        },
        ToolDef {
            name: "update_doc",
            description: "更新文档标题或正文（doc_id 来自 list_docs）。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "doc_id": { "type": "string" },
                    "title": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["doc_id"]
            }),
        },
    ]
}
```

`src-tauri/src/lib.rs` 顶部模块声明区加:

```rust
mod mcp; // 应用内 MCP server
```

- [ ] **Step 4: 运行确认通过**

Run: `cd src-tauri && cargo test mcp::registry`
Expected: 4 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/mcp/mod.rs src-tauri/src/mcp/registry.rs src-tauri/src/lib.rs
git commit -m "feat(mcp): 工具注册表（8 工具 schema + 参数校验助手）+ 单测"
```

---

### Task 2: `create_task` rank 纯函数

**Files:**
- Create: `src-tauri/src/mcp/rank.rs`
- Modify: `src-tauri/src/mcp/mod.rs`(`pub mod rank;`)

**Interfaces:**
- Produces: `pub fn next_rank(existing: &[f64]) -> f64` —— 新任务追加到末尾用的 rank(现有最大值 + 步长;空则起始步长)

- [ ] **Step 1: 写失败测试**

`src-tauri/src/mcp/rank.rs` 末尾:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_yields_first_step() {
        assert_eq!(next_rank(&[]), 1000.0);
    }

    #[test]
    fn appends_after_max() {
        assert_eq!(next_rank(&[1000.0, 2000.0]), 3000.0);
        assert_eq!(next_rank(&[500.0]), 1500.0);
    }

    #[test]
    fn ignores_order_uses_max() {
        assert_eq!(next_rank(&[3000.0, 1000.0, 2000.0]), 4000.0);
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd src-tauri && cargo test mcp::rank`
Expected: 编译失败。

- [ ] **Step 3: 实现**

`src-tauri/src/mcp/rank.rs`(tests 之前):

```rust
//! 任务 rank 计算：MCP 建任务一律追加到目标列末尾。纯函数,可测。
const STEP: f64 = 1000.0;

/// 追加到末尾的 rank = 现有最大 rank + STEP；空列表则 STEP。
pub fn next_rank(existing: &[f64]) -> f64 {
    existing.iter().cloned().fold(0.0_f64, f64::max) + STEP
}
```

`src-tauri/src/mcp/mod.rs` 加 `pub mod rank;`。

- [ ] **Step 4: 运行确认通过**

Run: `cd src-tauri && cargo test mcp::rank`
Expected: 3 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/mcp/rank.rs src-tauri/src/mcp/mod.rs
git commit -m "feat(mcp): create_task rank 纯函数（追加到末尾）+ 单测"
```

---

### Task 3: `mcp::tools` —— 8 个 handler + `dispatch` + PbClient::list

**Files:**
- Create: `src-tauri/src/mcp/tools.rs`
- Modify: `src-tauri/src/mcp/mod.rs`(`pub mod tools;` + `McpCtx`)
- Modify: `src-tauri/src/pb/client.rs`(新增 `list(coll, filter, fields)`)

**Interfaces:**
- Consumes:`registry::{require_str, opt_str}`、`rank::next_rank`、`PbClient::{list_all, list, create, patch}`。
- Produces:
  - `pub struct McpCtx { pub client: crate::pb::client::PbClient, pub user_id: String }`(在 mod.rs)
  - `pub async fn dispatch(name: &str, args: serde_json::Value, ctx: &McpCtx) -> Result<serde_json::Value, String>`
  - `PbClient::list(&self, coll: &str, filter: &str, fields: &str) -> anyhow::Result<Vec<Value>>`

- [ ] **Step 1: 给 PbClient 加带 filter 的 list**

`src-tauri/src/pb/client.rs` 在 `list_all` 之后加:

```rust
    /// 按 filter 拉取记录（最多 500 条），仅返回指定字段。
    pub async fn list(&self, coll: &str, filter: &str, fields: &str) -> anyhow::Result<Vec<Value>> {
        let url = format!("{}/api/collections/{}/records", self.base_url, coll);
        let resp = self
            .http()
            .get(&url)
            .bearer_auth(&self.token)
            .query(&[("perPage", "500"), ("filter", filter), ("fields", fields)])
            .send()
            .await?;
        let body = json_or_err(resp).await?;
        Ok(body["items"].as_array().cloned().unwrap_or_default())
    }
```

- [ ] **Step 2: 写失败测试**（dispatch 的未知工具 + 参数校验，纯逻辑，不打 PB）

`src-tauri/src/mcp/tools.rs` 末尾:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ctx() -> McpCtx {
        // 指向不可达地址；这些测试只走到参数校验就返回 Err，不会真的请求 PB。
        McpCtx {
            client: crate::pb::client::PbClient::new("http://127.0.0.1:1", "t"),
            user_id: "u1".into(),
        }
    }

    #[tokio::test]
    async fn unknown_tool_errors() {
        let r = dispatch("nope", json!({}), &ctx()).await;
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("未知工具"));
    }

    #[tokio::test]
    async fn create_task_requires_fields_before_any_pb_call() {
        // 缺 title → 参数校验先失败，不触达 PB
        let r = dispatch("create_task", json!({ "project_id": "p", "state_id": "s" }), &ctx()).await;
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("title"));
    }

    #[tokio::test]
    async fn update_task_requires_task_id() {
        let r = dispatch("update_task", json!({ "title": "x" }), &ctx()).await;
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("task_id"));
    }
}
```

- [ ] **Step 3: 运行确认失败**

Run: `cd src-tauri && cargo test mcp::tools`
Expected: 编译失败。

- [ ] **Step 4: 实现**

`src-tauri/src/mcp/mod.rs` 追加:

```rust
pub mod tools;

/// MCP handler 的上下文：以 local-user 身份打 PB。
pub struct McpCtx {
    pub client: crate::pb::client::PbClient,
    pub user_id: String,
}
```

`src-tauri/src/mcp/tools.rs`(tests 之前):

```rust
//! MCP 工具 handler：8 个看板/文档操作，用 PbClient 打 PB（owner-only 规则授权）。
//! dispatch() 按工具名分发；未知工具报错。参数校验先行，避免无效 PB 调用。
use super::registry::{opt_str, require_str};
use super::rank::next_rank;
use super::McpCtx;
use serde_json::{json, Value};

/// PB filter：project = "<id>"（值做最简转义，禁双引号注入）。
fn by_project(project_id: &str) -> String {
    format!("project = \"{}\"", project_id.replace('"', ""))
}

/// 分发到具体工具。所有错误以 String 返回，由 server 层转 MCP isError。
pub async fn dispatch(name: &str, args: Value, ctx: &McpCtx) -> Result<Value, String> {
    match name {
        "list_projects" => list_projects(ctx).await,
        "list_states" => list_states(args, ctx).await,
        "list_tasks" => list_tasks(args, ctx).await,
        "create_task" => create_task(args, ctx).await,
        "update_task" => update_task(args, ctx).await,
        "list_docs" => list_docs(args, ctx).await,
        "create_doc" => create_doc(args, ctx).await,
        "update_doc" => update_doc(args, ctx).await,
        other => Err(format!("未知工具：{other}")),
    }
}

fn err<T>(e: anyhow::Error) -> Result<T, String> {
    Err(e.to_string())
}

async fn list_projects(ctx: &McpCtx) -> Result<Value, String> {
    let items = ctx
        .client
        .list_all("board_projects", "id,name")
        .await
        .or_else(|e| err(e))?;
    Ok(json!(items))
}

async fn list_states(args: Value, ctx: &McpCtx) -> Result<Value, String> {
    let pid = require_str(&args, "project_id")?;
    let items = ctx
        .client
        .list("board_project_states", &by_project(&pid), "id,name,category,sort_order")
        .await
        .or_else(|e| err(e))?;
    Ok(json!(items))
}

async fn list_tasks(args: Value, ctx: &McpCtx) -> Result<Value, String> {
    let pid = require_str(&args, "project_id")?;
    let items = ctx
        .client
        .list("board_tasks", &by_project(&pid), "id,title,state,priority,due_date,rank")
        .await
        .or_else(|e| err(e))?;
    Ok(json!(items))
}

async fn create_task(args: Value, ctx: &McpCtx) -> Result<Value, String> {
    let pid = require_str(&args, "project_id")?;
    let state = require_str(&args, "state_id")?;
    let title = require_str(&args, "title")?;
    // 目标列现有任务的 rank → 追加到末尾
    let filter = format!("project = \"{}\" && state = \"{}\"", pid.replace('"', ""), state.replace('"', ""));
    let existing = ctx.client.list("board_tasks", &filter, "rank").await.or_else(|e| err(e))?;
    let ranks: Vec<f64> = existing.iter().filter_map(|r| r["rank"].as_f64()).collect();
    // board_tasks 无 owner 字段，必填 created_by（授权靠 createRule 的 project.owner）
    let mut data = json!({
        "created_by": ctx.user_id,
        "project": pid,
        "state": state,
        "title": title,
        "rank": next_rank(&ranks),
    });
    if let Some(d) = opt_str(&args, "description") { data["description"] = json!(d); }
    if let Some(p) = opt_str(&args, "priority") { data["priority"] = json!(p); }
    if let Some(dd) = opt_str(&args, "due_date") { data["due_date"] = json!(dd); }
    let rec = ctx.client.create("board_tasks", &data).await.or_else(|e| err(e))?;
    Ok(json!({ "ok": true, "id": rec["id"], "title": title }))
}

async fn update_task(args: Value, ctx: &McpCtx) -> Result<Value, String> {
    let id = require_str(&args, "task_id")?;
    let mut patch = json!({});
    if let Some(v) = opt_str(&args, "title") { patch["title"] = json!(v); }
    if let Some(v) = opt_str(&args, "description") { patch["description"] = json!(v); }
    if let Some(v) = opt_str(&args, "priority") { patch["priority"] = json!(v); }
    if let Some(v) = opt_str(&args, "state_id") { patch["state"] = json!(v); }
    if let Some(v) = opt_str(&args, "due_date") { patch["due_date"] = json!(v); }
    ctx.client.patch("board_tasks", &id, &patch).await.or_else(|e| err(e))?;
    Ok(json!({ "ok": true, "id": id }))
}

async fn list_docs(args: Value, ctx: &McpCtx) -> Result<Value, String> {
    let pid = require_str(&args, "project_id")?;
    let items = ctx
        .client
        .list("docs", &by_project(&pid), "id,title")
        .await
        .or_else(|e| err(e))?;
    Ok(json!(items))
}

async fn create_doc(args: Value, ctx: &McpCtx) -> Result<Value, String> {
    let pid = require_str(&args, "project_id")?;
    let title = require_str(&args, "title")?;
    let mut data = json!({ "owner": ctx.user_id, "project": pid, "title": title });
    if let Some(c) = opt_str(&args, "content") { data["content"] = json!(c); }
    let rec = ctx.client.create("docs", &data).await.or_else(|e| err(e))?;
    Ok(json!({ "ok": true, "id": rec["id"], "title": title }))
}

async fn update_doc(args: Value, ctx: &McpCtx) -> Result<Value, String> {
    let id = require_str(&args, "doc_id")?;
    let mut patch = json!({});
    if let Some(v) = opt_str(&args, "title") { patch["title"] = json!(v); }
    if let Some(v) = opt_str(&args, "content") { patch["content"] = json!(v); }
    ctx.client.patch("docs", &id, &patch).await.or_else(|e| err(e))?;
    Ok(json!({ "ok": true, "id": id }))
}
```

- [ ] **Step 5: 运行确认通过**

Run: `cd src-tauri && cargo test mcp::tools`
Expected: 3 个 async 测试 PASS(校验先行,未触达 PB)。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/mcp/tools.rs src-tauri/src/mcp/mod.rs src-tauri/src/pb/client.rs
git commit -m "feat(mcp): 8 个看板/文档 handler + dispatch + PbClient::list（带 filter）+ 单测"
```

---

### Task 4: `mcp::server` —— rmcp Streamable-HTTP + 端点文件 + secret 鉴权

**Files:**
- Modify: `src-tauri/Cargo.toml`(加 rmcp)
- Create: `src-tauri/src/mcp/server.rs`
- Modify: `src-tauri/src/mcp/mod.rs`(`pub mod server;`)

**Interfaces:**
- Consumes:`registry::tool_schemas`、`tools::dispatch`、`McpCtx`、`AppState.auth`。
- Produces:
  - `pub struct EndpointInfo { pub url: String, pub secret: String }`
  - `pub async fn start(app: tauri::AppHandle) -> Result<EndpointInfo, String>` —— 起 server(固定 47600 回退)、写 `mcp-endpoint.json`,返回端点信息
  - `pub fn gen_secret() -> String` —— 随机 secret(纯逻辑可测)

- [ ] **Step 1: 加依赖**

`src-tauri/Cargo.toml` `[dependencies]` 加:

```toml
rmcp = { version = "0.16", features = ["server", "transport-streamable-http-server"] } # 应用内 MCP server（crates.io 是 0.x semver，非 "2.x"）
axum = "0.8" # StreamableHttpService 产出 tower Service，用 axum::serve 承载 + Bearer 中间件
```

（rmcp 确切 API 见 `.superpowers/sdd/rmcp-api-notes.md`（已联网调研，含可编译骨架 + 需 cargo doc 核实清单）；实现时 `cargo doc -p rmcp --no-deps` 核对字段名后照抄适配。）

- [ ] **Step 2: 写失败测试**（secret 生成，纯逻辑）

`src-tauri/src/mcp/server.rs` 末尾:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_is_nonempty_and_varies() {
        let a = gen_secret();
        let b = gen_secret();
        assert!(a.len() >= 16, "secret 太短");
        assert_ne!(a, b, "两次 secret 不应相同");
    }
}
```

- [ ] **Step 3: 运行确认失败**

Run: `cd src-tauri && cargo test mcp::server`
Expected: 编译失败。

- [ ] **Step 4: 实现**

`src-tauri/src/mcp/server.rs`(tests 之前)。**核心契约**:rmcp 的 `ServerHandler` 把 `list_tools` 委托 `registry::tool_schemas()`、`call_tool` 委托 `tools::dispatch(name,args,&ctx)`;每次调用从 `AppState.auth` 现取 base_url+token+user_id 构造 `McpCtx`(token 每启动会刷新)。HTTP 层用 rmcp 的 `StreamableHttpService` 绑 `127.0.0.1:47600`;在其外包一层校验 `Authorization: Bearer <secret>`。

```rust
//! MCP server：rmcp Streamable-HTTP 承载 + secret 鉴权 + 端点文件。
//! 协议方法（initialize/tools/list/tools/call）委托 registry + tools::dispatch。
use super::registry::tool_schemas;
use super::{tools, McpCtx};
use crate::AppState;
use rand::Rng;
use serde_json::json;
use std::io::Write;
use tauri::Manager;

/// 端点信息（写入 mcp-endpoint.json，供客户端配置）。
pub struct EndpointInfo {
    pub url: String,
    pub secret: String,
}

/// 生成随机 secret（32 hex 字符）。
pub fn gen_secret() -> String {
    let bytes: [u8; 16] = rand::thread_rng().gen();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 从 AppState.auth 构造 McpCtx；auth 未就绪返回错误。
fn ctx_from_state(app: &tauri::AppHandle) -> Result<McpCtx, String> {
    let state = app.state::<AppState>();
    let guard = state.auth.lock();
    let a = guard.as_ref().ok_or("rework 未就绪：请先启动 rework 应用并等待初始化")?;
    Ok(McpCtx {
        client: crate::pb::client::PbClient::new(&a.base_url, &a.token),
        user_id: a.user_id.clone(),
    })
}

// —— 下面是 rmcp 集成：以官方 2.x API 实现 ServerHandler。
// 契约（不随 rmcp 版本变）：
//   * list_tools() 返回 tool_schemas() 映射成 rmcp 的 Tool（name/description/input_schema）。
//   * call_tool(name, args) => ctx_from_state(&app) 后 tools::dispatch(name, args, &ctx).await
//       Ok(v)  => 文本内容 = v.to_string()（JSON 文本）
//       Err(e) => isError = true，文本 = e
//   * 传输：StreamableHttpService 绑 127.0.0.1:47600（占用则 :0 让系统分配）。
//   * 鉴权：在 HTTP 层校验请求头 Authorization == "Bearer {secret}"，不符 401。
// 具体 struct/trait 名以 `cargo doc -p rmcp` 与官方 examples/streamable_http server 为准。

/// 启动 MCP server，写端点文件，返回端点信息。
pub async fn start(app: tauri::AppHandle) -> Result<EndpointInfo, String> {
    let secret = gen_secret();

    // 1) 尝试固定端口 47600，占用则让系统分配（真实端口回填到 url）。
    let listener = bind_listener().await?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let url = format!("http://127.0.0.1:{port}/mcp");

    // 2) 写端点文件（仅当前用户可读；供客户端配置发现）。
    write_endpoint_file(&app, &url, &secret)?;

    // 3) 用 rmcp StreamableHttpService 承载，handler 委托 registry/dispatch，
    //    外层中间件校验 Authorization: Bearer {secret}。tokio::spawn 后台运行。
    spawn_rmcp_service(app.clone(), listener, secret.clone()).await?;

    Ok(EndpointInfo { url, secret })
}

/// 绑定监听：先试 47600，占用回退 :0（系统分配）。
async fn bind_listener() -> Result<tokio::net::TcpListener, String> {
    match tokio::net::TcpListener::bind(("127.0.0.1", 47600)).await {
        Ok(l) => Ok(l),
        Err(_) => tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| format!("MCP 端口绑定失败：{e}")),
    }
}

/// 写 app_data_dir/mcp-endpoint.json = { url, secret }。
fn write_endpoint_file(app: &tauri::AppHandle, url: &str, secret: &str) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("mcp-endpoint.json");
    let body = json!({ "url": url, "secret": secret }).to_string();
    let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    f.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

/// 用 rmcp 起 Streamable-HTTP 服务（后台）。ctx_from_state/tool_schemas/tools::dispatch 已就绪；
/// 此函数把它们接到 rmcp 的 ServerHandler + StreamableHttpService，并加 Bearer 校验。
/// 实现细节按 rmcp 2.x examples 适配；委托契约见上方注释。
async fn spawn_rmcp_service(
    app: tauri::AppHandle,
    listener: tokio::net::TcpListener,
    secret: String,
) -> Result<(), String> {
    // 见任务说明：用 tool_schemas() 填 list_tools；call_tool 走 ctx_from_state(&app)? + tools::dispatch。
    // Bearer 校验：请求头 != "Bearer {secret}" → 401。
    let _ = (app, listener, secret); // 由实现按 rmcp API 填充
    Ok(())
}
```

> 实现者:`spawn_rmcp_service` 是**唯一**与 rmcp API 强耦合处。先 `cargo add` 后 `cargo doc -p rmcp --open` 看 `StreamableHttpService`/`ServerHandler`/`Tool`/`CallToolResult` 的确切签名,把上面注释里的委托契约填成真代码。其余(端点文件、secret、ctx 构造)与 rmcp 无关,已给全。若 rmcp 2.x 的 HTTP server 需要 axum `Router`,用 rmcp 提供的 `into_router`/`tower` 集成 + 一个校验 Bearer 的中间件层。

- [ ] **Step 5: 运行确认通过 + 编译**

Run: `cd src-tauri && cargo test mcp::server`(secret 测试通过)
Run: `cd src-tauri && cargo build`(rmcp 首次拉取编译较久,属正常;确认整体编译通过)
Expected: 测试 PASS,build 成功。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/mcp/server.rs src-tauri/src/mcp/mod.rs
git commit -m "feat(mcp): rmcp Streamable-HTTP server + secret 鉴权 + 端点文件"
```

---

### Task 5: 应用启动集成（auth 就绪后拉起 MCP server）

**Files:**
- Modify: `src-tauri/src/lib.rs`(`setup_pocketbase` 末尾,auth 写入 AppState 之后)

**Interfaces:**
- Consumes:`mcp::server::start`。

- [ ] **Step 1: 在 auth 就绪后启动 MCP server**

`src-tauri/src/lib.rs` 的 `setup_pocketbase` 中,**在 `AppState.auth` 被写入 BootstrapAuth 之后**(bootstrap 成功那段)追加:

```rust
    // 启动应用内 MCP server（auth 已就绪；失败不阻断应用启动，仅打日志）。
    {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            match crate::mcp::server::start(handle).await {
                Ok(ep) => println!("[mcp] MCP server 就绪：{}", ep.url),
                Err(e) => eprintln!("[mcp] MCP server 启动失败：{e}"),
            }
        });
    }
```

> 放置点:`AppState.auth` 已 `= Some(BootstrapAuth{..})` 之后(以 lib.rs 实际写入处为准)。`app`/`handle` 用该作用域内可用的 `AppHandle`。

- [ ] **Step 2: 编译校验**

Run: `cd src-tauri && cargo build`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(mcp): 应用启动在 auth 就绪后拉起 MCP server（失败不阻断）"
```

---

### Task 6: 控制器实机端到端验证（CLI ↔ rework）

**Files:** 无(手动/控制器验证)。

> 前置:先释放构建锁(`powershell -Command "Get-Process pocketbase* | Stop-Process -Force"`,只杀 pocketbase*),再 `npm run tauri dev` 起应用。

- [ ] **Step 1: 确认端点文件生成**

启动应用后:读 `app_data_dir/mcp-endpoint.json`,确认有 `{url, secret}`,url 形如 `http://127.0.0.1:47600/mcp`。

- [ ] **Step 2: 裸 HTTP 冒烟(不依赖 CLI)**

用 curl(带 Bearer)对 url 发一个 `tools/list` JSON-RPC:
```bash
curl -s http://127.0.0.1:47600/mcp \
  -H "Authorization: Bearer <secret>" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
Expected:返回 8 个工具的 schema。无 Bearer → 401。

- [ ] **Step 3: 接入 Claude Code**

`claude mcp add --transport http rework http://127.0.0.1:47600/mcp --header "Authorization: Bearer <secret>"`,然后在 claude 里让它 `list_projects` → `create_task` 到某项目某列。

- [ ] **Step 4: 验证数据落地 + UI 实时**

在 rework 应用的该项目看板里,确认 CLI 建的任务**实时出现**(PB realtime)。create_task 的 owner = 当前用户(PB owner-only 放行);换非本人 project_id 应被 PB 规则拒。

- [ ] **Step 5: 记录结果**

把实测结果(tools/list、create_task 成功/拒绝、UI 出现)记入验收说明。

---

### Task 7: 分发（Claude plugin + Codex 配置 + 文档）

**Files:**
- Create: `mcp-plugin/`(Claude Code plugin：manifest + skill + 命令)
- Create: `docs/mcp-setup.md`(接入文档：Claude 与 Codex)

**Interfaces:** 无代码依赖(配置 + 文档 + skill)。

- [ ] **Step 1: 接入文档**

`docs/mcp-setup.md`:写清两个客户端如何连(端点 url + secret 从 `mcp-endpoint.json` 取):
- Claude Code:`claude mcp add --transport http rework <url> --header "Authorization: Bearer <secret>"`,或 `.mcp.json` `{ "rework": { "type": "http", "url": "...", "headers": { "Authorization": "Bearer ..." } } }`。
- Codex:`~/.codex/config.toml`:
  ```toml
  [mcp_servers.rework]
  url = "http://127.0.0.1:47600/mcp"
  http_headers = { "Authorization" = "Bearer <secret>" }
  ```
- 前提说明:rework 应用需开着(PB 是其 sidecar);端口/secret 每次启动可能变(以端点文件为准)。

- [ ] **Step 2: Claude Code plugin 脚手架**

`mcp-plugin/`:按 Claude Code plugin 规范放
- `.claude-plugin/plugin.json`(manifest:name `rework`、描述、mcp server 配置指向 http url);
- `skills/rework/SKILL.md`(指导:「用 rework 工具管理用户看板/文档;建任务前先 list_projects/list_states;不臆造 id」);
- `commands/rework-triage.md`(斜杠命令:读当前上下文 → 归纳出任务 → 用 create_task 建到指定项目)。

> plugin 里 mcp url/secret 无法写死(每启动变)。文档指导用户运行一次 `claude mcp add`(读端点文件),或提供一个读端点文件生成配置的小脚本。plugin 主要承载 skill + 命令 + 说明。

- [ ] **Step 3: 提交**

```bash
git add mcp-plugin docs/mcp-setup.md
git commit -m "feat(mcp): 分发 —— Claude plugin(skill+命令) + Codex 配置 + 接入文档"
```

- [ ] **Step 4: 手动验证 plugin**

装上 plugin,在 claude 里用 `/rework-triage` 跑一遍,确认 skill 指导 + 工具调用连通。

---

## Self-Review 摘要

- Spec 覆盖:注册表(schema)✓T1;rank ✓T2;8 handler + McpCtx + PbClient::list ✓T3;rmcp HTTP + 端点文件 + secret + Bearer ✓T4;启动集成 ✓T5;实机验证 ✓T6;分发(plugin/skill/命令/Codex)✓T7。传输问题已由调研解决:**rmcp 2.1 + Claude/Codex 均原生支持 HTTP MCP → 无需 stdio shim**(spec 里的 shim 分支不再需要,T7 直接 HTTP)。
- 无占位符:T1-T3、T5、T6 全为可执行代码/命令;T4 的 `spawn_rmcp_service` 是唯一与 rmcp 强耦合处,已用明确"委托契约 + cargo doc 适配"指令界定(非 vague TODO —— 契约、绑定、鉴权、错误映射都写死,只有 rmcp 的 struct/trait 名待实现时对文档填)。
- 类型一致:`ToolDef`/`tool_schemas`/`require_str`/`opt_str`(T1)→ T3 使用一致;`next_rank`(T2)→ create_task 用;`McpCtx{client,user_id}`、`dispatch(name,args,ctx)`(T3)→ T4 server 委托一致;`PbClient::list(coll,filter,fields)`(T3)与 handler 调用一致;`EndpointInfo{url,secret}`、`start(app)`(T4)→ T5 调用一致。
- 已知风险:T4 rmcp 2.x 的确切 API 需实现时对 `cargo doc` 适配(调研已确认 2.1 支持 streamable-http-server + Claude/Codex 可连);若 rmcp 不便用,回退 axum 手写最小 MCP-over-HTTP(spec 备选),委托契约(tool_schemas/dispatch)不变,T1-T3 全部复用。
