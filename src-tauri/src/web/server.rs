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
use crate::models::Session;
use crate::web::api::{ApiState, BootstrapAuthResp};
use crate::web::auth::{check_and_rotate, issue_token, verify_token, AuthState};
use crate::web::pb_proxy::{pb_proxy_handler, PbProxyState};
use axum::{
    body::Body,
    extract::State,
    http::{header, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{any, get, post},
    Router,
};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::oneshot;
use tower_http::services::ServeDir;

/// Gateway 侧会话缓存共享句柄（与 AppState.sessions 同一 Arc）。
pub type SessionsState = Arc<Mutex<Vec<Session>>>;

/// `/ws/terminal/{id}` handler 的共享状态：PTY 会话表 + provider 注册表 + 已知会话集合。
///
/// 三者均以 `Arc` 共享（与 `AppState.web_pty` / `AppState.reg` / `AppState.sessions` 同一实例），
/// 供 WS handler 在 spawn 的 server 任务里 open/write/resize/read/kill PTY，并按 provider 路由命令。
/// `sessions` 用于 I-1 纵深防御：project_path 必须属于已知项目集合，拒绝任意系统目录作 cwd。
#[derive(Clone)]
pub struct WsTerminalState {
    /// 内嵌 PTY 会话表（与 AppState.web_pty 同一 Arc）。
    pub pty: Arc<crate::web::terminal::PtyRegistry>,
    /// provider 注册表（与 AppState.reg 同一 Arc），供 `by_id` 白名单路由 + argv 命令生成。
    pub reg: Arc<crate::providers::ProviderRegistry>,
    /// 已知会话列表（与 AppState.sessions 同一 Arc），供 project_path 集合校验（I-1）。
    pub sessions: SessionsState,
}

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

/// 公开路径白名单（默认拒绝 allowlist）。
///
/// 只放精确已知的公开资源，不按扩展名后缀放行——后缀放行会被
/// `/%61pi/x.json`、`/API/x.json`、`//api/x.json`、`/a/../pb/x.css` 等编码/大小写/
/// 路径归一化差异击穿（中间件不解码 path，下游 PB 反代会解码，解释层不一致 = CWE-436）。
/// allowlist 的误判方向是 fail-safe（要求 token），不存在放行本应受保护的路径的风险。
///
/// dist/ 根静态清点（须未认证加载的首屏资源）：
/// - `/keelson.svg`：index.html `<link rel="icon">` 引用作 favicon → 加入白名单。
/// - `/vite.svg`：index.html 未直接引用，但 matches! 中保留（dist/ 静态资源兼容）。
/// - `/tauri.svg`：dist/ 中存在但 index.html 首屏未直接引用 → 不加。
/// - `/assets/*`：前端构建产物目录（JS/CSS/map 等）→ 前缀匹配放行。
///
/// 新增公开路径须在此显式登记——这是刻意保留的评审卡点，而非疏漏窗口。
fn is_public_path(path: &str) -> bool {
    matches!(
        path,
        "/healthz" | "/pair" | "/" | "/index.html" | "/favicon.ico" | "/vite.svg" | "/keelson.svg"
    ) || path.starts_with("/assets/")
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
    // check_and_rotate：原子「校验配对码 + 成功则立即轮换」——全程持 pairing_code 锁，
    // 杜绝并发同一旧码换多个 token 的 TOCTOU（I-2 安全修复）。
    if !check_and_rotate(&auth, &body.code) {
        // 配对码错误或处于限流退避窗口：统一 401，不泄露具体原因。
        return StatusCode::UNAUTHORIZED.into_response();
    }
    // 校验通过：旧码已在 check_and_rotate 内轮换作废，现签发 token。
    let token = issue_token(&auth, "web".to_string());

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
/// 找不到 dist 时的占位页：明确提示「web dist 未构建」，不 panic、不暴露内部路径。
async fn dist_missing_placeholder() -> Response {
    let html = "<!doctype html><html lang=\"zh\"><head><meta charset=\"utf-8\">\
<title>Keelson</title></head><body style=\"font-family:sans-serif;padding:2rem\">\
<h1>web dist 未构建</h1><p>前端静态资源尚未构建。请运行前端构建后重启 Gateway。</p>\
</body></html>";
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response()
}

/// 装配 Web Gateway 的 axum Router（路由集中此处，鉴权边界统一审计）。
///
/// 结构：业务/静态路由 → 外层套 `require_token` 中间件（默认拒绝）。
/// `auth` 由 gateway `start` 与中间件共享（同一 `Arc<AuthState>`）。
///
/// `pb_base`：PocketBase 服务根地址（形如 `http://127.0.0.1:<port>`），
/// 由调用方从 `AppState.auth` 取出后传入，此处不做任何解析——仅透传给 `PbProxyState`。
/// `/pb/{*path}` 路由**不在** `is_public_path` 白名单里，`require_token` layer 自动覆盖。
///
/// `api_state`：PB bootstrap 认证信息（token/userId），供 `/api/bootstrap_auth` 返回给
/// 已配对 web 端。在 require_token layer 内，未配对设备无法到达。
///
/// `sessions_state`：会话缓存共享句柄（与 AppState.sessions 同一 Arc），供
/// `/api/sessions_list` 返回给已配对 web 端（token 闸内）。
fn build_router(
    auth: Arc<AuthState>,
    pb_base: String,
    api_state: ApiState,
    sessions_state: SessionsState,
    ws_terminal: WsTerminalState,
    dist_dir: Option<PathBuf>,
) -> Router {
    // 静态前端：dist 目录（由调用方按 dev 源码 / 生产 Resource 解析后传入）存在则 ServeDir，
    // 否则所有 GET 回落占位页。编译期路径已弃用——生产打包机路径在用户机不存在会永远占位。
    let static_service = match dist_dir.filter(|d| d.is_dir()) {
        Some(dir) => Router::new().fallback_service(ServeDir::new(dir)),
        None => Router::new().fallback(dist_missing_placeholder),
    };

    // PB 反代子路由（独立 Router + with_state，避免与 AuthState 共用状态冲突）。
    // `/pb/{*path}` axum 0.8 通配捕获语法；`any(...)` 接受所有 HTTP 方法（GET/POST/PATCH…）。
    // 此路由**不**添加至公开白名单——进入此 Router 前已过 `require_token` layer。
    let pb_proxy_state = PbProxyState::new(pb_base);
    let pb_router = Router::new()
        .route("/pb/{*path}", any(pb_proxy_handler))
        .with_state(pb_proxy_state);

    // WS 终端子路由（独立 Router + with_state 注入 WsTerminalState）。
    // `/ws/terminal/{id}` **不在** `is_public_path` 白名单 → 进入此 Router 前已过 `require_token`
    // layer（升级握手请求带 cookie，中间件校验 token 通过才会触达 handler → 未鉴权连接不 open PTY）。
    let ws_router = Router::new()
        .route(
            "/ws/terminal/{id}",
            get(crate::web::terminal::ws_terminal_handler),
        )
        .with_state(ws_terminal);

    // `/api/bootstrap_auth`：捕获 api_state 到闭包，避免与 AuthState 状态冲突。
    // 直接以 move 闭包注册路由，无需额外子 Router + with_state（规避 axum 0.8 的
    // Router<()> into Router<Arc<AuthState>> 类型推断问题）。
    // `/api/bootstrap_auth` handler（闭包捕获 api_state，规避 axum Router<()> 类型推断问题）。
    // 返回 PB token/userId 给已配对 web 端（不含 baseUrl，web 端经 /pb 反代访问 PocketBase）。
    let api_state_clone = api_state;
    let bootstrap_auth_handler = move || {
        let state = api_state_clone.clone();
        async move {
            let guard = state.lock();
            match guard.as_ref() {
                Some(auth) => {
                    let resp = BootstrapAuthResp {
                        token: auth.token.clone(),
                        user_id: auth.user_id.clone(),
                    };
                    (StatusCode::OK, axum::Json(resp)).into_response()
                }
                None => {
                    // PB bootstrap 尚未完成：503，web 端可短暂重试
                    (StatusCode::SERVICE_UNAVAILABLE, "PocketBase 尚未就绪").into_response()
                }
            }
        }
    };

    // `/api/sessions_list`：闭包捕获 sessions_state，同 bootstrap_auth 模式（规避 axum 0.8
    // Router<()> 类型推断限制）。调用 `sessions::list_core` 复用与 Tauri command 相同的读锁逻辑。
    // 在 require_token layer 内，未配对设备无法到达此路由。
    let sessions_state_clone = sessions_state;
    let sessions_list_handler = move || {
        let state = sessions_state_clone.clone();
        async move {
            let sessions = crate::commands::sessions::list_core(&state);
            (StatusCode::OK, axum::Json(sessions)).into_response()
        }
    };

    Router::new()
        // 健康探针：常量 "ok"，无敏感信息（白名单公开）。
        .route("/healthz", get(|| async { "ok" }))
        // 配对入口：受配对码 + 限流保护，成功签发 token 并轮换旧码（白名单公开）。
        .route("/pair", post(pair_handler))
        // 受保护 API 路由（/api/bootstrap_auth）：token 闸内，不在白名单。
        // 返回 PB token/userId 供 web 端初始化 PB SDK（不含 baseUrl，经 /pb 反代访问）。
        .route("/api/bootstrap_auth", post(bootstrap_auth_handler))
        // 受保护 API 路由（/api/sessions_list）：token 闸内，不在白名单。
        // 返回全量会话列表 Vec<Session> JSON（Task 8 工作台栏）。
        .route("/api/sessions_list", post(sessions_list_handler))
        // PB 同源反向代理（token 闸内，防 SSRF）。
        .merge(pb_router)
        // WS 终端双向泵（token 闸内，非白名单 → require_token 自动覆盖握手）。
        .merge(ws_router)
        // 静态前端兜底（含占位页回落）。`/ws/terminal` 已在此之前显式注册即受保护。
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
/// `pb_base`：PocketBase 服务根地址（形如 `http://127.0.0.1:<port>`），
/// 由调用方从 `AppState.auth` 获取并传入，用于 `/pb/*` 反代路由。
/// 若 PB 尚未就绪（`AppState.auth` 为 `None`），传入空串即可——gateway
/// 会将所有 `/pb/*` 请求 502 返回，不会 panic 也不影响其他路由。
///
/// `api_state`：PB bootstrap 认证信息（token/userId），写入后供 `/api/bootstrap_auth`
/// 返回给已配对 web 端。PB 就绪前为 `None`，届时 bootstrap_auth 返回 503。
///
/// `sessions_state`：会话缓存共享句柄（与 AppState.sessions 同一 Arc），
/// 供 `/api/sessions_list` 返回给已配对 web 端（token 闸内）。
///
/// server 在后台 `tokio::spawn` 运行，通过 `oneshot` 接收优雅关闭信号；调用方拿到
/// 端口后无需等待 server 结束。绑定（await）在同步取锁之外进行，避免持锁跨 await。
pub async fn start(
    port: u16,
    auth: Arc<AuthState>,
    pb_base: String,
    api_state: ApiState,
    sessions_state: SessionsState,
    ws_terminal: WsTerminalState,
    dist_dir: Option<PathBuf>,
) -> Result<(u16, GatewayHandle), String> {
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
    let router = build_router(auth, pb_base, api_state, sessions_state, ws_terminal, dist_dir);

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
        // build_router 应无 panic 地构造出 Router（含中间件、API 路由、PB 反代路由与静态兜底）。
        use crate::models::Session;
        use crate::web::api::ApiState;
        use parking_lot::Mutex;
        let auth = Arc::new(AuthState::new());
        let api_state: ApiState = Arc::new(Mutex::new(None));
        let sessions_state: SessionsState = Arc::new(Mutex::new(Vec::<Session>::new()));
        let ws_terminal = WsTerminalState {
            pty: Arc::new(crate::web::terminal::PtyRegistry::new()),
            reg: Arc::new(crate::providers::ProviderRegistry::new()),
            sessions: sessions_state.clone(),
        };
        let _router = build_router(
            auth,
            "http://127.0.0.1:8790".to_string(),
            api_state,
            sessions_state,
            ws_terminal,
            None, // 测试不装载 dist（走占位页回落分支）
        );
    }

    #[test]
    fn public_path_whitelist_is_tight() {
        // 白名单只放精确登记的路径和 /assets/ 前缀；其余一律受保护。
        assert!(is_public_path("/healthz"));
        assert!(is_public_path("/pair"));
        assert!(is_public_path("/"));
        assert!(is_public_path("/index.html"));
        assert!(is_public_path("/favicon.ico"));
        assert!(is_public_path("/keelson.svg")); // index.html <link rel="icon"> 引用作 favicon → 白名单
        assert!(is_public_path("/vite.svg"));   // matches! 登记保留（dist/ 中存在）
        assert!(is_public_path("/assets/app.js"));
        // 能力/数据路径默认拒绝——即便带静态扩展名伪装也不放行（纯 allowlist，无扩展名后缀规则）。
        assert!(!is_public_path("/api/ping"));
        assert!(!is_public_path("/api/sessions.json"));
        assert!(!is_public_path("/pb/collections"));
        assert!(!is_public_path("/ws"));
        assert!(!is_public_path("/secret"));
        // dist/ 根中存在但首屏未引用的 SVG —— 不加白名单（按需认证后加载）。
        assert!(!is_public_path("/tauri.svg"));
    }

    #[test]
    fn public_whitelist_no_bypass() {
        // 编码/大小写/双斜杠/路径穿越等绕过向量必须全部返回 false（fail-safe）。
        // 纯 allowlist（无扩展名后缀规则）从根本上消除 CWE-436 解释层差异击穿。
        for p in [
            "/%61pi/x.json",     // URL 编码 'a'（%61）→ api
            "/API/x.json",       // 大小写变体
            "//api/x.json",      // 双斜杠规一化后 → /api
            "/a/../pb/x.css",    // 路径穿越 → /pb/x.css
            "/api/sessions.json",// 扩展名伪装（旧规则会放行，新 allowlist 不放行）
            "/pb/x.js",
            "/ws/t",
        ] {
            assert!(!is_public_path(p), "must NOT be public: {p}");
        }
        for p in ["/healthz", "/pair", "/", "/index.html", "/assets/app.js", "/vite.svg"] {
            assert!(is_public_path(p), "must be public: {p}");
        }
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
