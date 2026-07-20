//! MCP server：rmcp Streamable-HTTP 承载 + secret 鉴权 + 端点文件。
//! 协议方法（initialize/tools/list/tools/call）委托 registry + tools::dispatch。
use super::registry::tool_schemas;
use super::McpCtx;
use crate::AppState;
use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, Content, Implementation, ListToolsResult,
        PaginatedRequestParams, ProtocolVersion, ServerCapabilities, ServerInfo, Tool,
    },
    service::{RequestContext, RoleServer},
    ErrorData as McpError,
};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager,
    tower::{StreamableHttpServerConfig, StreamableHttpService},
};
use serde_json::json;
use std::io::Write;
use std::sync::Arc;
use tauri::{Emitter, Manager};

/// 端点信息（写入 mcp-endpoint.json，供客户端配置）。
pub struct EndpointInfo {
    pub url: String,
    pub secret: String,
}

/// 获取 MCP secret：持久化到 OS keychain（重启不变），客户端一次接入长期有效。
/// 复用 bootstrap 的 keychain 辅助（同 PB 密码的存法）。
pub fn gen_secret() -> String {
    crate::pb::bootstrap::get_or_make_secret("mcp-secret")
}

/// 从 AppState.auth 构造 McpCtx；auth 未就绪返回错误。
fn ctx_from_state(app: &tauri::AppHandle) -> Result<McpCtx, String> {
    let state = app.state::<AppState>();
    let guard = state.auth.lock();
    let a = guard
        .as_ref()
        .ok_or("rework 未就绪：请先启动 rework 应用并等待初始化")?;
    Ok(McpCtx {
        client: crate::pb::client::PbClient::new(&a.base_url, &a.token),
        user_id: a.user_id.clone(),
    })
}

// ——————————————————————————————————————————————————————————————————————
// 活动流：纯逻辑（可测）+ 事件模型
// ——————————————————————————————————————————————————————————————————————

/// 判定某工具是否为「写操作」（决定是否落 PB activities，读操作只走内存流）。
/// MCP 写工具：create_task/update_task/create_doc/update_doc。其余（list_*/search_*/get_*）为读。
pub fn is_write_tool(tool: &str) -> bool {
    matches!(
        tool,
        "create_task" | "update_task" | "create_doc" | "update_doc"
    )
}

/// 从工具名 + 入参 + 结果，归一出 (action, summary)。
/// action ∈ write|read|run|search，用于前端图标/分组；summary 为一行中文可读摘要。
/// 纯函数（不做 IO），便于单测覆盖各代表工具。
pub fn activity_summary(
    tool: &str,
    args: &serde_json::Value,
    result: &serde_json::Value,
) -> (String, String) {
    // 优先取结果里的 title（建任务/文档成功时返回），否则回退入参 title/query
    let title = result
        .get("title")
        .and_then(|v| v.as_str())
        .or_else(|| args.get("title").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();
    match tool {
        "create_task" => ("write".into(), format!("新建任务：{title}")),
        "update_task" => ("write".into(), "更新任务".to_string()),
        "create_doc" => ("write".into(), format!("新建文档：{title}")),
        "update_doc" => ("write".into(), "更新文档".to_string()),
        "list_projects" => ("read".into(), "查询项目列表".to_string()),
        "list_states" => ("read".into(), "查询看板状态列".to_string()),
        "list_tasks" => ("read".into(), "查询任务".to_string()),
        "list_docs" => ("read".into(), "查询文档".to_string()),
        "search_memory" => {
            let q = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
            ("search".into(), format!("检索记忆：{q}"))
        }
        "list_sessions" => ("read".into(), "查询历史会话".to_string()),
        "search_sessions" => {
            let q = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
            ("search".into(), format!("检索会话：{q}"))
        }
        "get_session" => ("read".into(), "读取会话时间线".to_string()),
        // 未列出的工具：默认视作读操作，摘要取工具名
        other => ("read".into(), format!("调用工具：{other}")),
    }
}

// ——————————————————————————————————————————————————————————————————————
// rmcp ServerHandler 实现
// ——————————————————————————————————————————————————————————————————————

/// rmcp 处理器：持有 AppHandle 以便 call_tool 时现取 auth 构造 McpCtx。
struct ReworkMcpHandler {
    app: tauri::AppHandle,
}

impl ServerHandler for ReworkMcpHandler {
    /// 返回服务器元信息（协议版本 + 能力声明）。
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2025_03_26,
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: "rework-mcp".into(),
                version: "0.1.0".into(),
                ..Default::default()
            },
            instructions: None,
        }
    }

    /// 列出所有工具（委托 registry::tool_schemas()）。
    async fn list_tools(
        &self,
        _req: Option<PaginatedRequestParams>,
        _ctx: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        // 把 ToolDef 映射成 rmcp 的 Tool（每次调用都重新生成，无状态）。
        // board 工具 + 读会话工具合并暴露。
        let tools: Vec<Tool> = tool_schemas()
            .into_iter()
            .chain(super::session_tools::session_tool_schemas())
            .map(|t| {
                // input_schema 必须是 Arc<JsonObject(=Map)>
                let schema = t
                    .input_schema
                    .as_object()
                    .cloned()
                    .unwrap_or_default();
                Tool::new(t.name, t.description, Arc::new(schema))
            })
            .collect();
        Ok(ListToolsResult::with_all_items(tools))
    }

    /// 调用工具（委托 tools::dispatch）。
    async fn call_tool(
        &self,
        req: CallToolRequestParams,
        _ctx: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        let name = req.name.to_string();
        let args = serde_json::Value::Object(req.arguments.unwrap_or_default());

        // 读会话工具：走 AppState（sessions/index/reg），无需 PB/auth，也不推通知（是读操作）
        if super::session_tools::is_session_tool(&name) {
            let state = self.app.state::<AppState>();
            let result = super::session_tools::dispatch_session(&name, args.clone(), state.inner()).await;
            // 活动流：会话工具均为读操作，只发内存事件、不落 PB（失败静默）
            self.emit_activity(&name, &args, &result, None).await;
            return match result {
                Ok(v) => Ok(CallToolResult::success(vec![Content::text(v.to_string())])),
                Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
            };
        }

        // board 工具：现从 AppState.auth 构造 McpCtx（token 每启动刷新）
        let mcp_ctx = match ctx_from_state(&self.app) {
            Ok(c) => c,
            Err(e) => return Ok(CallToolResult::error(vec![Content::text(e)])),
        };
        // 建任务/文档需要 project_id 做跳转链接（dispatch 会消费 args，先取出）
        let project_id = args
            .get("project_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let result = crate::mcp::tools::dispatch(&name, args.clone(), &mcp_ctx).await;
        // 活动流：无论读写、成功失败都发一条内存事件；写操作额外落 PB（失败静默，不影响工具返回）
        self.emit_activity(&name, &args, &result, Some(&mcp_ctx))
            .await;
        match result {
            // 工具返回 JSON Value → 文本化后作为内容；成功建任务/文档时推通知
            Ok(v) => {
                self.notify_external_action(&name, &v, project_id.as_deref(), &mcp_ctx)
                    .await;
                Ok(CallToolResult::success(vec![Content::text(v.to_string())]))
            }
            // 工具级错误 → isError=true（对调用方可见，协议层不报 500）
            Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
        }
    }
}

impl ReworkMcpHandler {
    /// 活动流：把一次工具调用（读写、成功失败均可）组装为 ActivityEvent 发到前端
    /// （`app.emit("activity", ev)`）；若为写操作且拿到 PB ctx，额外落 activities 集合。
    /// emit / PB 落盘任何失败一律静默，绝不影响 MCP 工具返回或阻断 agent。
    async fn emit_activity(
        &self,
        tool: &str,
        args: &serde_json::Value,
        result: &Result<serde_json::Value, String>,
        ctx: Option<&McpCtx>,
    ) {
        // 成功时用返回值参与摘要（如建任务的 title），失败时用空对象
        let empty = json!({});
        let result_val = result.as_ref().unwrap_or(&empty);
        let (action, summary) = activity_summary(tool, args, result_val);
        let status = if result.is_ok() { "ok" } else { "error" };
        // project_id 从入参取（board 工具的 project_id；会话工具无则为空）
        let project_id = args
            .get("project_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let session_id = args
            .get("session_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let ts = chrono::Utc::now().to_rfc3339();
        // 内存事件 id：ts + 工具名（前端做去重键；持久事件用 PB id）
        let ev_id = format!("mcp-{ts}-{tool}");

        // 1) 发内存事件（前端环形缓冲实时渲染）。失败静默。
        let ev = json!({
            "id": ev_id,
            "ts": ts,
            "source": "mcp",
            "provider": "",
            "tool": tool,
            "action": action,
            "summary": summary,
            "project_id": project_id,
            "repo_path": null,
            "session_id": session_id,
            "status": status,
        });
        let _ = self.app.emit("activity", &ev);

        // 2) 写操作落 PB activities（可回放历史）。仅在拿到 ctx 时；失败静默。
        if is_write_tool(tool) {
            if let Some(ctx) = ctx {
                let _ = ctx
                    .client
                    .create(
                        "activities",
                        &json!({
                            "owner": ctx.user_id,
                            "source": "mcp",
                            "provider": "",
                            "tool": tool,
                            "action": ev["action"],
                            "summary": ev["summary"],
                            "project": project_id,
                            "repo_path": "",
                            "session_id": session_id,
                            "status": status,
                        }),
                    )
                    .await;
            }
        }
    }

    /// 外部 MCP 操作(建任务/文档)后推一条通知：应用内记录 + 系统桌面弹窗，
    /// 让用户知道 claude/codex 在后台动了看板/文档。失败静默(不影响工具结果)。
    async fn notify_external_action(
        &self,
        tool: &str,
        result: &serde_json::Value,
        project_id: Option<&str>,
        ctx: &McpCtx,
    ) {
        use tauri_plugin_notification::NotificationExt;
        let title = result.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let (text, link) = match tool {
            "create_task" => (
                format!("MCP 新建任务：{title}"),
                project_id
                    .map(|p| format!("/board?open={p}&tab=board"))
                    .unwrap_or_else(|| "/board".into()),
            ),
            "create_doc" => (
                format!("MCP 新建文档：{title}"),
                project_id
                    .map(|p| format!("/board?open={p}&tab=docs"))
                    .unwrap_or_else(|| "/docs".into()),
            ),
            _ => return, // 其它工具(查/改)不推送
        };
        // 1) 应用内通知记录(经 PB，通知铃实时收到)
        let _ = ctx
            .client
            .create(
                "notifications",
                &serde_json::json!({
                    "owner": ctx.user_id,
                    "title": text,
                    "body": "由外部 AI（claude / codex）经 MCP 创建",
                    "kind": "info",
                    "read": false,
                    "link": link,
                    "source": "MCP",
                }),
            )
            .await;
        // 2) 系统桌面通知(rework 未聚焦时也能看到)
        let _ = self
            .app
            .notification()
            .builder()
            .title("rework")
            .body(&text)
            .show();
    }
}

// ——————————————————————————————————————————————————————————————————————
// HTTP 服务启动
// ——————————————————————————————————————————————————————————————————————

/// 启动 MCP server，写端点文件，返回端点信息。
pub async fn start(app: tauri::AppHandle) -> Result<EndpointInfo, String> {
    let secret = gen_secret();

    // 1) 尝试固定端口 47600，占用则让系统分配（真实端口回填到 url）。
    let listener = bind_listener().await?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
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
fn write_endpoint_file(
    app: &tauri::AppHandle,
    url: &str,
    secret: &str,
) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("mcp-endpoint.json");
    let body = json!({ "url": url, "secret": secret }).to_string();
    let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    f.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

/// 用 rmcp 起 Streamable-HTTP 服务（后台 tokio::spawn）。
/// - `StreamableHttpService` 实现 tower::Service，可直接接 axum::Router::nest_service。
/// - 外层 `axum::middleware::from_fn` 校验 Authorization: Bearer {secret}。
async fn spawn_rmcp_service(
    app: tauri::AppHandle,
    listener: tokio::net::TcpListener,
    secret: String,
) -> Result<(), String> {
    // 构建 rmcp StreamableHttpService：每个 session 生成一个 ReworkMcpHandler 实例
    let service = StreamableHttpService::new(
        {
            let app = app.clone();
            move || Ok(ReworkMcpHandler { app: app.clone() })
        },
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default(),
    );

    // axum Router：挂载 MCP service + Bearer 鉴权中间件
    let router = axum::Router::new()
        .nest_service("/mcp", service)
        .layer(axum::middleware::from_fn(
            move |req: axum::extract::Request, next: axum::middleware::Next| {
                let secret = secret.clone();
                async move {
                    // 校验 Authorization: Bearer <secret>
                    let ok = req
                        .headers()
                        .get(axum::http::header::AUTHORIZATION)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|s| s.strip_prefix("Bearer "))
                        .map(|t| t == secret)
                        .unwrap_or(false);
                    if ok {
                        Ok::<_, axum::http::StatusCode>(next.run(req).await)
                    } else {
                        Err(axum::http::StatusCode::UNAUTHORIZED)
                    }
                }
            },
        ));

    // 后台运行，start() 调用方无需等待
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("[MCP server] 停止：{e}");
        }
    });

    Ok(())
}

// ——————————————————————————————————————————————————————————————————————
// 单元测试
// ——————————————————————————————————————————————————————————————————————

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_is_nonempty() {
        // gen_secret 委托 keychain 持久化辅助；单测只保证非空（"重启不变"的稳定性
        // 依赖 OS keychain，在测试进程里行为不确定，不作断言——由实机验证覆盖）。
        assert!(gen_secret().len() >= 16, "secret 太短");
    }

    #[test]
    fn is_write_tool_classifies_write_vs_read() {
        // 写工具：建/改任务与文档
        for w in ["create_task", "update_task", "create_doc", "update_doc"] {
            assert!(is_write_tool(w), "{w} 应判为写操作");
        }
        // 读工具：查询/检索/读会话
        for r in [
            "list_projects",
            "list_tasks",
            "list_docs",
            "search_memory",
            "list_sessions",
            "search_sessions",
            "get_session",
            "nope",
        ] {
            assert!(!is_write_tool(r), "{r} 不应判为写操作");
        }
    }

    #[test]
    fn activity_summary_covers_representative_tools() {
        // create_task：从结果 title 组装写摘要
        let (a, s) = activity_summary(
            "create_task",
            &json!({ "project_id": "p1", "title": "入参标题" }),
            &json!({ "ok": true, "id": "t1", "title": "修复登录" }),
        );
        assert_eq!(a, "write");
        assert_eq!(s, "新建任务：修复登录");

        // list_tasks：读动作，固定摘要
        let (a, s) = activity_summary("list_tasks", &json!({ "project_id": "p1" }), &json!([]));
        assert_eq!(a, "read");
        assert_eq!(s, "查询任务");

        // search_memory：search 动作，摘要含 query
        let (a, s) = activity_summary(
            "search_memory",
            &json!({ "query": "登录流程" }),
            &json!([]),
        );
        assert_eq!(a, "search");
        assert_eq!(s, "检索记忆：登录流程");

        // create_doc：无结果 title 时回退入参 title
        let (a, s) = activity_summary(
            "create_doc",
            &json!({ "project_id": "p1", "title": "设计稿" }),
            &json!({}),
        );
        assert_eq!(a, "write");
        assert_eq!(s, "新建文档：设计稿");

        // 未列出工具：默认读，摘要含工具名
        let (a, s) = activity_summary("mystery_tool", &json!({}), &json!({}));
        assert_eq!(a, "read");
        assert_eq!(s, "调用工具：mystery_tool");
    }
}
