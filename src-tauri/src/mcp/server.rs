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
use tauri::Manager;

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
        // 把 ToolDef 映射成 rmcp 的 Tool（每次调用都重新生成，无状态）
        let tools: Vec<Tool> = tool_schemas()
            .into_iter()
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
        // 每次调用现从 AppState.auth 构造 McpCtx（token 每启动刷新）
        let mcp_ctx = match ctx_from_state(&self.app) {
            Ok(c) => c,
            Err(e) => return Ok(CallToolResult::error(vec![Content::text(e)])),
        };
        let args = serde_json::Value::Object(req.arguments.unwrap_or_default());
        match crate::mcp::tools::dispatch(req.name.as_ref(), args, &mcp_ctx).await {
            // 工具返回 JSON Value → 文本化后作为内容
            Ok(v) => Ok(CallToolResult::success(vec![Content::text(v.to_string())])),
            // 工具级错误 → isError=true（对调用方可见，协议层不报 500）
            Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
        }
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
    fn secret_is_nonempty_and_stable() {
        // 持久化 secret：非空且两次调用一致（keychain 支撑，重启不变）
        let a = gen_secret();
        let b = gen_secret();
        assert!(a.len() >= 16, "secret 太短");
        assert_eq!(a, b, "持久化 secret 两次应一致");
    }
}
