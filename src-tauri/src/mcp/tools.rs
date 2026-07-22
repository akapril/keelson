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
        "search_memory" => search_memory(args, ctx).await,
        "create_memory" => create_memory(args, ctx).await,
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
    // board_tasks 无 owner 字段，必填 created_by（授权靠 createRule 的 project.owner）。
    let mut data = json!({
        "created_by": ctx.user_id,
        "project": pid,
        "state": state,
        "title": title,
        "rank": next_rank(&ranks),
        // board_tasks 的 priority 为必填（PB 非空校验）；与前端 store 一致默认 "none"，
        // 调用方传了则下方覆盖。缺此默认会导致 MCP 建任务 PB 400。
        "priority": "none",
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

/// docs 多对多过滤：projects 关系「包含」该项目 id（值做最简转义，禁双引号注入）。
fn docs_by_project(project_id: &str) -> String {
    format!("projects ~ \"{}\"", project_id.replace('"', ""))
}

async fn list_docs(args: Value, ctx: &McpCtx) -> Result<Value, String> {
    let pid = require_str(&args, "project_id")?;
    let items = ctx
        .client
        .list("docs", &docs_by_project(&pid), "id,title")
        .await
        .or_else(|e| err(e))?;
    Ok(json!(items))
}

async fn create_doc(args: Value, ctx: &McpCtx) -> Result<Value, String> {
    let pid = require_str(&args, "project_id")?;
    let title = require_str(&args, "title")?;
    // 多对多：写 projects 数组（含当前项目）
    let mut data = json!({ "owner": ctx.user_id, "projects": [pid], "title": title });
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

/// 记忆账本写入（外部 AI 沉淀经验）。默认 status=pending，需用户在 rework 采纳后才生效。
/// owner=当前用户；带 source_provider=mcp 溯源；scope=project 时必须给 project_id。
async fn create_memory(args: Value, ctx: &McpCtx) -> Result<Value, String> {
    let content = require_str(&args, "content")?;
    let kind = opt_str(&args, "kind").unwrap_or_else(|| "fact".into());
    if !["fact", "preference", "decision", "convention"].contains(&kind.as_str()) {
        return Err(format!("kind 非法：{kind}（应为 fact/preference/decision/convention）"));
    }
    let scope = opt_str(&args, "scope").unwrap_or_else(|| "project".into());
    if !["global", "project"].contains(&scope.as_str()) {
        return Err(format!("scope 非法：{scope}（应为 global/project）"));
    }
    let project = opt_str(&args, "project_id").unwrap_or_default();
    if scope == "project" && project.is_empty() {
        return Err("scope=project 时需提供 project_id".into());
    }
    let data = json!({
        "owner": ctx.user_id,
        "content": content,
        "kind": kind,
        "scope": scope,
        "project": project,
        "confidence": 1,
        "status": "pending",
        "source_provider": "mcp",
        "source_session_id": "",
        "source_anchor": "",
        "superseded_by": "",
    });
    let rec = ctx.client.create("memories", &data).await.or_else(|e| err(e))?;
    Ok(json!({ "ok": true, "id": rec["id"], "status": "pending" }))
}

/// 检索记忆账本（关键词/kind/scope 过滤，排除被合并的记忆与待审记忆）。Pull 注入的读侧。
async fn search_memory(args: Value, ctx: &McpCtx) -> Result<Value, String> {
    // 只检索已采纳的记忆：排除待审(pending)——它们尚未被用户确认。空 status 为历史已采纳，保留。
    let mut clauses: Vec<String> =
        vec!["superseded_by = \"\"".to_string(), "status != \"pending\"".to_string()];
    if let Some(q) = opt_str(&args, "query") {
        if !q.trim().is_empty() {
            clauses.push(format!("content ~ \"{}\"", q.replace('"', "")));
        }
    }
    if let Some(k) = opt_str(&args, "kind") {
        clauses.push(format!("kind = \"{}\"", k.replace('"', "")));
    }
    if let Some(sc) = opt_str(&args, "scope") {
        clauses.push(format!("scope = \"{}\"", sc.replace('"', "")));
    }
    let filter = clauses.join(" && ");
    let items = ctx
        .client
        .list("memories", &filter, "content,kind,scope,confidence,project")
        .await
        .or_else(|e| err(e))?;
    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
    Ok(json!(items.into_iter().take(limit).collect::<Vec<_>>()))
}

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

    #[tokio::test]
    async fn create_memory_requires_content() {
        let r = dispatch("create_memory", json!({ "kind": "fact" }), &ctx()).await;
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("content"));
    }

    #[tokio::test]
    async fn create_memory_project_scope_needs_project_id() {
        // 有 content 但 scope=project(默认) 且无 project_id → 参数校验失败，不触达 PB
        let r = dispatch("create_memory", json!({ "content": "x" }), &ctx()).await;
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("project_id"));
    }

    #[tokio::test]
    async fn create_memory_rejects_bad_kind() {
        let r = dispatch(
            "create_memory",
            json!({ "content": "x", "kind": "bogus", "scope": "global" }),
            &ctx(),
        )
        .await;
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("kind"));
    }
}
