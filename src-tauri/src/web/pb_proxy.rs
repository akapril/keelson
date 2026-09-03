//! PocketBase 同源反向代理：把 `/pb/*path` 请求原样转发到本机 PocketBase。
//!
//! # 安全设计
//! - **目标地址硬编码本机**：`pb_base` 由 AppState.auth 在启动时确定，形如
//!   `http://127.0.0.1:<port>`，全程不允许 path/header 注入改写目标主机（防 SSRF）。
//! - **此 handler 不在公开白名单**：由 `build_router` 挂在 `require_token` layer 内部，
//!   任何未携带有效 `kln_token` cookie 的请求均在中间件层被 401 拒绝，不会到达此 handler。
//! - **只转发合法 HTTP headers**：逐一过滤请求头，跳过 `host`（防止 SNI 混淆）；
//!   响应头同样逐一转发（保留 Content-Type / Content-Length 等），跳过 hop-by-hop 头。
//! - **不做任意 URL 代理**：目标永远是 `{pb_base}/{path}?{query}`，path 来自已经过
//!   axum 路由解析的 `{*path}` 捕获组，query string 原样拼接。

use axum::{
    body::Body,
    extract::{Path, RawQuery, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
};
use reqwest::header::{HeaderName, HeaderValue};
use std::sync::Arc;

/// `/pb/*` 代理 handler 所需的共享状态（仅 PB base URL）。
///
/// 由 `build_router` 通过 `.with_state(PbProxyState { pb_base })` 注入。
/// `pb_base` 形如 `http://127.0.0.1:<port>`，运行时不可变（启动后硬编码来自 bootstrap）。
#[derive(Clone)]
pub struct PbProxyState {
    /// PocketBase 服务根地址，形如 `http://127.0.0.1:<port>`。
    /// `Arc<String>` 保证多请求共享时零拷贝、零锁开销。
    pub pb_base: Arc<String>,
    /// 共享的 reqwest 客户端（连接池复用，避免每请求重建 TLS 握手开销）。
    pub client: reqwest::Client,
    /// web 功能开关（与 AppState.web_features 同一 Arc）：按集合门控内容 tab 数据。
    pub features: crate::web::api::WebFeaturesState,
}

/// 从 `/pb` 反代 path 解析 PB 集合名并按功能开关判定是否放行。
///
/// path 形如 `api/collections/<coll>/records...`。只门控**内容 tab 对应集合**
/// （calendar_events→calendar、board_*→board、docs/doc_assets/reading_items→docs）；
/// 其余（认证 `api/collections/users/auth-*`、realtime、notifications、memories 等）一律放行，
/// 避免破坏 PB SDK 内部路径。纯函数，可 standalone 测。
pub fn pb_path_allowed(path: &str, f: &crate::config::WebFeatures) -> bool {
    let coll = path
        .strip_prefix("api/collections/")
        .and_then(|rest| rest.split('/').next());
    match coll {
        Some("calendar_events") => f.calendar,
        Some(c) if c.starts_with("board_") => f.board,
        Some("docs") | Some("doc_assets") | Some("reading_items") => f.docs,
        _ => true, // 其余集合 / 认证 / realtime 放行
    }
}

impl PbProxyState {
    /// 构造：传入 PB base URL（形如 `http://127.0.0.1:<port>`）+ 功能开关 Arc。
    /// reqwest::Client 在此构建并复用——连接池、超时等统一在此配置。
    pub fn new(pb_base: String, features: crate::web::api::WebFeaturesState) -> Self {
        let client = reqwest::Client::builder()
            // 绕过代理：反代目标是本机 PB(127.0.0.1)，禁走系统/环境代理，
            // 否则代理已就绪时会拦截 localhost 请求致连接中止（os error 10053）。
            .no_proxy()
            // 禁止 reqwest 自动跟随 302/301 跳转到其他主机（防 SSRF 升级路径）。
            // PB 本身不做跨域重定向，保险起见显式禁用。
            .redirect(reqwest::redirect::Policy::none())
            // 对本机 PB 的请求超时 60s（覆盖大多数流式响应，避免连接永久挂起）。
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("构建 PB 代理 reqwest 客户端失败"); // 仅在 TLS 配置异常时 panic，正常情况不会触发
        Self {
            pb_base: Arc::new(pb_base),
            client,
            features,
        }
    }
}

/// hop-by-hop 头名称列表（RFC 2616 §13.5.1）：代理转发时须跳过这些头，
/// 避免把连接级属性传给后端或回传给客户端。
const HOP_BY_HOP: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
];

/// 判断某个响应头是否为 hop-by-hop（不应转发给客户端）。
fn is_hop_by_hop(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    HOP_BY_HOP.iter().any(|h| *h == lower)
}

/// `GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS /pb/{*path}` 统一入口。
///
/// 流程：
/// 1. 拼接目标 URL：`{pb_base}/{path}?{raw_query}`（目标主机硬编码，不可注入）
/// 2. 转发请求方法 + 请求头（过滤 host/hop-by-hop）+ body
/// 3. 流式透传响应（body 用 reqwest stream → axum Body::from_stream，
///    覆盖 PB 的大响应/实时 SSE 场景）
/// 4. 原样回传 PB 的 status + 响应头（过滤 hop-by-hop）
///
/// **已在 `require_token` layer 之内**：到达此 handler 时 token 已验证通过。
pub async fn pb_proxy_handler(
    State(state): State<PbProxyState>,
    method: Method,
    Path(path): Path<String>,
    RawQuery(raw_query): RawQuery,
    req_headers: HeaderMap,
    body: Body,
) -> Response {
    // ── 0. 功能开关门控：关掉的内容 tab 对应集合直接 403（后端强制，纵深防御）。 ──
    if !pb_path_allowed(&path, &state.features.lock()) {
        return StatusCode::FORBIDDEN.into_response();
    }

    // ── 1. 构造目标 URL（防 SSRF：主机固定为 pb_base，不从 path/header 取） ──
    // path 已由 axum 从 `/pb/{*path}` 捕获，不包含前导 `/pb`。
    // `RawQuery` 提取已编码的原始 query string，直接透传（避免先 decode 再 encode 的双重编码）。
    let target_url = match raw_query {
        Some(qs) => format!("{}/{}?{}", state.pb_base, path, qs),
        None => format!("{}/{}", state.pb_base, path),
    };

    // ── 2. 转发请求头（过滤 host + hop-by-hop，保留 Authorization / Content-Type 等） ──
    let mut fwd_headers = reqwest::header::HeaderMap::new();
    for (name, value) in &req_headers {
        let n = name.as_str();
        // 跳过 `host`：避免把 gateway host 传给 PB，PB 会据此做虚拟主机判断
        if n.eq_ignore_ascii_case("host") {
            continue;
        }
        // 跳过 hop-by-hop 头（连接级，不应跨代理传递）
        if is_hop_by_hop(n) {
            continue;
        }
        // 跳过 gateway 自身的 cookie（kln_token），PB 不认识它也不需要，
        // 传过去是噪声且可能触发 PB 的 cookie 解析逻辑（虽无实质风险，保持干净）。
        // 注意：若前端有 PB 自己的 cookie（如 pb_auth），那些在不同 cookie 键名下，
        // 此处仅精确移除 `kln_token=…` 部分，其余 cookie 保留透传。
        if n.eq_ignore_ascii_case("cookie") {
            // 重写 Cookie 头：过滤掉 kln_token，保留其余 cookie（PB 可能需要）
            if let Ok(raw) = value.to_str() {
                let filtered: Vec<&str> = raw
                    .split(';')
                    .map(str::trim)
                    .filter(|pair| !pair.starts_with("kln_token="))
                    .collect();
                if !filtered.is_empty() {
                    if let (Ok(hn), Ok(hv)) = (
                        HeaderName::from_bytes(b"cookie"),
                        HeaderValue::from_str(&filtered.join("; ")),
                    ) {
                        fwd_headers.insert(hn, hv);
                    }
                }
                // cookie 头已处理，跳过下方通用插入
                continue;
            }
        }
        // 通用头：直接透传（HeaderName/HeaderValue 的 bytes 接口，避免 UTF-8 转换失败丢头）
        if let (Ok(hn), Ok(hv)) = (
            HeaderName::from_bytes(name.as_str().as_bytes()),
            HeaderValue::from_bytes(value.as_bytes()),
        ) {
            fwd_headers.append(hn, hv);
        }
    }

    // ── 3. 把 axum Body 转成 reqwest 可用的字节流 ──
    // `axum::body::to_bytes` 会把请求体全量缓存到内存；对 PB 的写接口（创建记录等）
    // 请求体通常很小（JSON），全缓存可接受。若未来有大文件上传需求，可改为 stream 透传。
    let body_bytes = match axum::body::to_bytes(body, 16 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[pb-proxy] 读取请求体失败: {e}");
            return StatusCode::BAD_REQUEST.into_response();
        }
    };

    // ── 4. 发出请求到本机 PB ──
    let pb_req = state
        .client
        .request(
            // reqwest::Method 与 axum::http::Method 共用同一底层类型（http crate），
            // 但包装不同；通过字符串中转是最兼容的方式。
            reqwest::Method::from_bytes(method.as_str().as_bytes())
                .unwrap_or(reqwest::Method::GET),
            &target_url,
        )
        .headers(fwd_headers)
        .body(body_bytes);

    let pb_resp = match pb_req.send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[pb-proxy] 转发到 PB 失败 ({target_url}): {e}");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };

    // ── 5. 构造回传响应（status + headers + 流式 body） ──
    let status = StatusCode::from_u16(pb_resp.status().as_u16())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);

    let mut resp_headers = HeaderMap::new();
    for (name, value) in pb_resp.headers() {
        // 跳过 hop-by-hop 响应头（不应透传给客户端）
        if is_hop_by_hop(name.as_str()) {
            continue;
        }
        if let (Ok(hn), Ok(hv)) = (
            header::HeaderName::from_bytes(name.as_str().as_bytes()),
            header::HeaderValue::from_bytes(value.as_bytes()),
        ) {
            resp_headers.append(hn, hv);
        }
    }

    // 流式透传响应 body（PB 实时事件流 / 大列表查询均适用）：
    // `bytes_stream()` 返回 `impl Stream<Item=Result<Bytes, reqwest::Error>>`，
    // `Body::from_stream` 接受此类型，axum 会以 chunked transfer 流式发给客户端。
    let stream = pb_resp.bytes_stream();
    let axum_body = Body::from_stream(stream);

    (status, resp_headers, axum_body).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hop_by_hop_detection() {
        // 标准 hop-by-hop 头必须被识别
        assert!(is_hop_by_hop("connection"));
        assert!(is_hop_by_hop("Connection")); // 大小写不敏感
        assert!(is_hop_by_hop("Transfer-Encoding"));
        assert!(is_hop_by_hop("keep-alive"));
        // 普通头不应被误判
        assert!(!is_hop_by_hop("content-type"));
        assert!(!is_hop_by_hop("authorization"));
        assert!(!is_hop_by_hop("content-length"));
        assert!(!is_hop_by_hop("x-custom-header"));
    }

    #[test]
    fn pb_path_gate_maps_collections_to_flags() {
        use crate::config::WebFeatures;
        // 全关：内容集合被拒，认证/realtime/其它放行
        let off = WebFeatures { calendar: false, board: false, docs: false, ..Default::default() };
        assert!(!pb_path_allowed("api/collections/calendar_events/records", &off));
        assert!(!pb_path_allowed("api/collections/board_tasks/records", &off));
        assert!(!pb_path_allowed("api/collections/board_project_states/records", &off));
        assert!(!pb_path_allowed("api/collections/docs/records", &off));
        assert!(!pb_path_allowed("api/collections/doc_assets/records", &off));
        // 非内容集合与认证/realtime 一律放行（即使全关）
        assert!(pb_path_allowed("api/collections/users/auth-refresh", &off));
        assert!(pb_path_allowed("api/collections/notifications/records", &off));
        assert!(pb_path_allowed("api/realtime", &off));
        // 全开：内容集合放行
        let on = WebFeatures::default();
        assert!(pb_path_allowed("api/collections/calendar_events/records", &on));
        assert!(pb_path_allowed("api/collections/board_tasks/records", &on));
        assert!(pb_path_allowed("api/collections/docs/records", &on));
    }

    #[test]
    fn pb_proxy_state_new_builds_without_panic() {
        use parking_lot::Mutex;
        use std::sync::Arc;
        // 构造 PbProxyState 不应 panic（仅验证 reqwest Client 能正常构建）
        let feats = Arc::new(Mutex::new(crate::config::WebFeatures::default()));
        let _ = PbProxyState::new("http://127.0.0.1:8790".to_string(), feats);
    }
}
