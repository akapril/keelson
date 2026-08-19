//! PocketBase 集成层：进程、客户端、首启初始化。
pub mod process;
pub mod bootstrap; // Task 5
pub mod client;    // Task 5

/// 构建「绕过代理」的本地 HTTP 客户端——专供连本机 PocketBase(`127.0.0.1:<port>`)用。
///
/// 背景：reqwest 默认读取 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` 环境变量。开机自启时
/// 代理工具（Clash/V2Ray 等）通常已设好这些变量，reqwest 会把连 localhost 的 PB 请求
/// 也发给代理，而代理够不到本机回环地址 → 连接被中止（Windows `os error 10053`）。
/// `.no_proxy()` 强制该客户端永不走任何代理，保证本地 PB 直连不受代理影响。
/// 注意：远程 AI / 抓取等客户端**不**用此函数（用户可能需靠代理访问外网）。
pub(crate) fn local_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .build()
        // 构建失败（仅 TLS 配置异常）时退回默认客户端，至少不 panic
        .unwrap_or_else(|_| reqwest::Client::new())
}
