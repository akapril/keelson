//! Web Gateway：外网可达的 axum HTTP+WS server。默认关闭，由设置开启。
//!
//! ⚠️ 安全红线（务必遵守）：
//! 本 server 绑定 **0.0.0.0**，意味着同网/外网设备均可访问——与仅本机可达的 MCP
//! server（127.0.0.1）性质不同。**认证中间件在 Task 3 才挂载；在此之前，本文件
//! 严禁挂载任何暴露数据 / 能力（会话、任务、文档、PTY、文件系统等）的路由。**
//! Task 1 仅提供 `/healthz`（返回常量 "ok"，不含任何敏感信息），可安全暴露。
//!
//! 路由装配集中在 `build_router()` 一处：Task 3 在此统一追加认证中间件
//! （`axum::middleware::from_fn(...)`）与业务路由，避免鉴权遗漏在分散的路由点上。
use axum::{routing::get, Router};
use tokio::sync::oneshot;

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

/// 装配 Web Gateway 的 axum Router（路由集中此处，便于 Task 3 统一加认证中间件）。
///
/// ⚠️ Task 1 仅允许 `/healthz`。新增暴露数据/能力的路由前，必须先在此挂载认证中间件。
fn build_router() -> Router {
    Router::new()
        // 健康探针：返回常量 "ok"，无敏感信息，可在无鉴权下安全暴露。
        .route("/healthz", get(|| async { "ok" }))
}

/// 起 gateway，绑 `0.0.0.0:port`（port=0 时系统随机分配）。返回实际端口 + 句柄。
///
/// server 在后台 `tokio::spawn` 运行，通过 `oneshot` 接收优雅关闭信号；调用方拿到
/// 端口后无需等待 server 结束。绑定（await）在同步取锁之外进行，避免持锁跨 await。
pub async fn start(port: u16) -> Result<(u16, GatewayHandle), String> {
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
    let router = build_router();

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
        // build_router 应无 panic 地构造出 Router（Task 1 仅 /healthz）。
        let _router = build_router();
    }
}
