//! Web Gateway：外网可达的 axum HTTP+WS server。默认关闭，由设置开启。
//!
//! ⚠️ 安全红线（务必遵守）：
//! 本 server 绑定 **0.0.0.0**，意味着同网/外网设备均可访问——与仅本机可达的 MCP
//! server（127.0.0.1）性质不同。
//!
//! Task 3 起：认证中间件 `require_token` 作为 `build_router()` 的**最外层 layer**，
//! 对**所有**请求生效（默认拒绝）。白名单仅放行 `/healthz`、`POST /pair` 与静态资源；
//! 其余一切路径（含未来的 `/api /pb /ws`）默认必须携带有效 token cookie。
//! 这从结构上杜绝「后续新增路由忘挂认证 → 裸奔」的窗口——新路由若不在白名单，
//! 天然被拦。新增「公开路由」须显式改 `is_public_path`，属有意为之的评审点。
//!
//! 路由装配集中在 `build_router()` 一处，便于统一审计鉴权边界。
use crate::web::auth::{check_pairing, issue_token, rotate_pairing_code, verify_token, AuthState};
use axum::{
    body::Body,
    extract::State,
    http::{header, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::oneshot;
use tower_http::services::ServeDir;

/// Gateway 运行句柄：持有实际端口 + 优雅关闭信号发送端。
///
/// `oneshot::Sender` 非 Clone——故存于 `AppState` 的 `Option` 中，停止时 `take()`
/// 取出再 `send(())` 触发 `with_graceful_shutdown`。
pub struct GatewayHandle {
    /// 实际监听端口（port=0 传入时为系统分配的随机端口）。
    pub port: u16,
    /// 优雅关闭信号发送端（发送 `()` 即请求 server 停止）。
    pub shutdown: oneshot::Sender<()>,
}

/// Cookie 名：token 存于此 HttpOnly cookie，浏览器每请求自动带上。
const TOKEN_COOKIE: &str = "kln_token";

/// 从请求头 `Cookie:` 中解析出 `kln_token` 的值（手动解析，避免引 axum-extra）。
///
/// Cookie 头形如 `a=1; kln_token=xxx; b=2`；按 `;` 切分、去空白、匹配键名。
/// 找不到返回空串（交由 `verify_token` 判为无效）。
fn extract_token_cookie(req: &Request<Body>) -> String {
    let Some(raw) = req
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
    else {
        return String::new();
    };
    for pair in raw.split(';') {
        let pair = pair.trim();
        if let Some(val) = pair.strip_prefix(&format!("{TOKEN_COOKIE}=")) {
            return val.to_string();
        }
    }
    String::new()
}

/// 是否为「无需认证」的公开路径（白名单，默认拒绝之外的显式豁免）。
///
/// ⚠️ 安全边界：仅以下三类放行——
/// 1. `/healthz`：健康探针，返回常量，无敏感信息。
/// 2. `/pair`：配对入口，本身受配对码 + 限流保护（认证前的唯一合法入口）。
/// 3. 静态前端资源：GET 类的页面/JS/CSS/图标等，供未配对设备渲染配对页。
///
/// 其余一切（`/api /pb /ws` 及任何未知路径）返回 false → 需 token。
/// 新增公开路径须在此显式登记——这是刻意保留的评审卡点，而非疏漏窗口。
fn is_public_path(path: &str) -> bool {
    // 健康探针与配对入口：精确匹配。
    if path == "/healthz" || path == "/pair" {
        return true;
    }
    // 显式受保护的能力前缀：即便未来误配静态路由，也绝不当公开资源放行。
    if path.starts_with("/api") || path.starts_with("/pb") || path.starts_with("/ws") {
        return false;
    }
    // 静态前端：根路径、index、常见前端资源目录/扩展名。
    if path == "/" || path == "/index.html" || path == "/favicon.ico" {
        return true;
    }
    if path.starts_with("/assets/") {
        return true;
    }
    // 按静态资源扩展名放行（前端构建产物）。
    let static_ext = [
        ".js", ".css", ".map", ".ico", ".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp",
        ".woff", ".woff2", ".ttf", ".json", ".txt", ".html", ".wasm",
    ];
    static_ext.iter().any(|ext| path.ends_with(ext))
}

/// 认证中间件：`build_router()` 的最外层 layer，对所有请求生效（默认拒绝）。
///
/// 公开路径（`is_public_path`）直接放行；其余从 cookie 取 token，`verify_token`
/// 失败即 401。token 明文永不落地，`verify_token` 内做常量时间 hash 比对。
async fn require_token(
    State(auth): State<Arc<AuthState>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let path = req.uri().path();
    if is_public_path(path) {
        return next.run(req).await;
    }
    let token = extract_token_cookie(&req);
    if verify_token(&auth, &token) {
        next.run(req).await
    } else {
        // 不泄露细节：统一 401，不区分「无 cookie / token 无效」。
        StatusCode::UNAUTHORIZED.into_response()
    }
}

/// `/pair` 请求体：`{ "code": "<配对码>" }`。
#[derive(serde::Deserialize)]
struct PairReq {
    code: String,
}

/// `POST /pair`：校验配对码 → 成功签发 token 并 Set-Cookie → **轮换配对码**（旧码失效）。
///
/// 成功流程严格为 check_pairing → issue_token → rotate_pairing_code（转交项 2）：
/// 旧配对码用一次即作废，杜绝「泄露旧码 = 永久后门」。失败返回 401（含限流退避）。
///
/// Cookie 手动设 `Set-Cookie`（避免引 axum-extra）：
/// `HttpOnly`（JS 不可读，防 XSS 窃取）+ `Secure`（仅 HTTPS）+ `SameSite=Strict`（防 CSRF）
/// + `Path=/`（全站生效）。
async fn pair_handler(
    State(auth): State<Arc<AuthState>>,
    axum::Json(body): axum::Json<PairReq>,
) -> Response {
    if !check_pairing(&auth, &body.code) {
        // 配对码错误或处于限流退避窗口：统一 401，不泄露具体原因。
        return StatusCode::UNAUTHORIZED.into_response();
    }
    // 校验通过：签发 token（明文仅此一次可见），随即轮换配对码使旧码失效。
    let token = issue_token(&auth, "web".to_string());
    rotate_pairing_code(&auth);

    // 手动构造 Set-Cookie：安全属性一次写全。
    let cookie = format!(
        "{TOKEN_COOKIE}={token}; HttpOnly; Secure; SameSite=Strict; Path=/"
    );
    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        "paired",
    )
        .into_response()
}

/// 解析静态前端 dist 目录：dev 指向 crate 同级 `../dist`（项目根）。
///
/// 返回 `Some(path)` 仅当目录存在；否则返回 `None`，由调用方回落到占位页（不 panic）。
fn resolve_dist_dir() -> Option<PathBuf> {
    // CARGO_MANIFEST_DIR = src-tauri；项目根 dist 在其上一级。
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("dist"));
    if let Some(ref d) = dev {
        if d.is_dir() {
            return dev;
        }
    }
    None
}

/// 找不到 dist 时的占位页：明确提示「web dist 未构建」，不 panic、不暴露内部路径。
async fn dist_missing_placeholder() -> Response {
    let html = "<!doctype html><html lang=\"zh\"><head><meta charset=\"utf-8\">\
<title>rework</title></head><body style=\"font-family:sans-serif;padding:2rem\">\
<h1>web dist 未构建</h1><p>前端静态资源尚未构建。请运行前端构建后重启 Gateway。</p>\
</body></html>";
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response()
}

/// 装配 Web Gateway 的 axum Router（路由集中此处，鉴权边界统一审计）。
///
/// 结构：业务/静态路由 → 外层套 `require_token` 中间件（默认拒绝）。
/// `auth` 由 gateway `start` 与中间件共享（同一 `Arc<AuthState>`）。
fn build_router(auth: Arc<AuthState>) -> Router {
    // 静态前端：dist 存在则 ServeDir，否则所有 GET 回落占位页。
    let static_service = match resolve_dist_dir() {
        Some(dir) => Router::new().fallback_service(ServeDir::new(dir)),
        None => Router::new().fallback(dist_missing_placeholder),
    };

    Router::new()
        // 健康探针：常量 "ok"，无敏感信息（白名单公开）。
        .route("/healthz", get(|| async { "ok" }))
        // 配对入口：受配对码 + 限流保护，成功签发 token 并轮换旧码（白名单公开）。
        .route("/pair", post(pair_handler))
        // 静态前端兜底（含占位页回落）。未来 `/api /pb /ws` 在此之前显式注册即受保护。
        .merge(static_service)
        // ⚠️ 最外层默认拒绝：非白名单路径一律需有效 token。新增路由自动受此约束。
        .layer(middleware::from_fn_with_state(auth.clone(), require_token))
        .with_state(auth)
}

/// 起 gateway，绑 `0.0.0.0:port`（port=0 时系统随机分配）。返回实际端口 + 句柄。
///
/// `auth` 由调用方（`AppState.web_auth`）传入，与认证中间件共享同一实例，
/// 保证配对码/token 状态与设置栏展示（Task 5）一致。
///
/// server 在后台 `tokio::spawn` 运行，通过 `oneshot` 接收优雅关闭信号；调用方拿到
/// 端口后无需等待 server 结束。绑定（await）在同步取锁之外进行，避免持锁跨 await。
pub async fn start(port: u16, auth: Arc<AuthState>) -> Result<(u16, GatewayHandle), String> {
    // 绑定 0.0.0.0：外网可达（详见文件顶部安全红线）。
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|e| format!("Web Gateway 绑定失败: {e}"))?;
    // 取实际端口（port=0 时为系统分配值，需回填给前端展示 / 客户端连接）。
    let actual = listener
        .local_addr()
        .map_err(|e| format!("获取本地地址失败: {e}"))?
        .port();

    let (tx, rx) = oneshot::channel::<()>();
    let router = build_router(auth);

    // 后台运行：收到 shutdown 信号（rx 完成）后优雅退出。
    tokio::spawn(async move {
        let result = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                // 发送端 drop 或显式 send(()) 均会使 rx 完成，从而触发关闭。
                let _ = rx.await;
            })
            .await;
        if let Err(e) = result {
            eprintln!("[web-gateway] 停止：{e}");
        }
    });

    Ok((actual, GatewayHandle { port: actual, shutdown: tx }))
}

#[cfg(test)]
mod tests {
    use super::*;

    // 说明：Tauri + Windows 下 `cargo test --lib` 存在 0xc0000139 平台限制，
    // 本模块测试仅覆盖不依赖 Tauri 运行时的纯逻辑（路由装配可构造，不实际监听端口）。

    #[test]
    fn router_builds() {
        // build_router 应无 panic 地构造出 Router（含中间件与静态兜底）。
        let auth = Arc::new(AuthState::new());
        let _router = build_router(auth);
    }

    #[test]
    fn public_path_whitelist_is_tight() {
        // 白名单只放 healthz / pair / 静态资源；能力前缀一律受保护。
        assert!(is_public_path("/healthz"));
        assert!(is_public_path("/pair"));
        assert!(is_public_path("/"));
        assert!(is_public_path("/index.html"));
        assert!(is_public_path("/assets/app.js"));
        assert!(is_public_path("/logo.svg"));
        // 能力/数据路径默认拒绝（即便带静态扩展名伪装也不放行）。
        assert!(!is_public_path("/api/ping"));
        assert!(!is_public_path("/api/sessions.json")); // 扩展名伪装不生效：/api 前缀先判死
        assert!(!is_public_path("/pb/collections"));
        assert!(!is_public_path("/ws"));
        assert!(!is_public_path("/secret")); // 未知路径默认拒绝
    }

    #[test]
    fn cookie_parsing_extracts_token() {
        use axum::http::Request;
        let req = Request::builder()
            .header(header::COOKIE, "foo=1; kln_token=abc123; bar=2")
            .body(Body::empty())
            .unwrap();
        assert_eq!(extract_token_cookie(&req), "abc123");
        // 无 cookie 头 → 空串。
        let bare = Request::builder().body(Body::empty()).unwrap();
        assert_eq!(extract_token_cookie(&bare), "");
    }
}
