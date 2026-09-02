//! Web Gateway API 路由：受 token 闸保护的 `/api/*` 端点类型定义。
//!
//! 安全边界（与 server.rs 白名单设计一致）：
//! - 本模块定义共享类型（BootstrapAuthResp / ApiState），handler 逻辑以闭包形式内联于
//!   `server.rs::build_router`（规避 axum 0.8 Router<()> into Router<S> 类型推断限制）。
//! - `BootstrapAuthResp` 只含 token/userId，不含 baseUrl（web 端经 /pb 反代访问 PocketBase）。
//!
//! 新增受保护 API 端点：在 server.rs `build_router` 中以 `.route("/api/<path>", ...)` 注册。

use parking_lot::Mutex;
use serde::Serialize;
use std::sync::Arc;

/// gateway 侧存储的 PB 认证信息（token/userId）。响应时由 handler 合并实时 features 一起返回。
/// 不含 baseUrl（web 端固定用 /pb 反代，不暴露内部 PocketBase 地址）。
#[derive(Debug, Serialize)]
pub struct BootstrapAuthResp {
    pub token: String,
    #[serde(rename = "userId")]
    pub user_id: String,
}

/// gateway 侧共享的 web 功能开关句柄（与 AppState.web_features 同一 Arc，热更新可见）。
pub type WebFeaturesState = Arc<Mutex<crate::config::WebFeatures>>;

/// Gateway 侧持有的 PB 认证信息（bootstrap 完成后由 setup_pocketbase 写入）。
///
/// `Option<BootstrapAuthResp>`：PB bootstrap 完成前为 `None`（gateway 先于 PB 就绪时
/// 此窗口期内的 /api/bootstrap_auth 请求会得到 503）；bootstrap 完成后写入，此后只读。
pub type ApiState = Arc<Mutex<Option<BootstrapAuthResp>>>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_auth_resp_serializes_correctly() {
        // 确认 JSON 字段名符合前端期望（userId 驼峰，非 user_id）
        let resp = BootstrapAuthResp {
            token: "tok123".into(),
            user_id: "uid456".into(),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"userId\""), "应序列化为 userId（驼峰），实际: {json}");
        assert!(json.contains("\"token\""), "应包含 token 字段，实际: {json}");
        assert!(!json.contains("user_id"), "不应含 snake_case user_id 字段，实际: {json}");
    }

    #[test]
    fn api_state_starts_none() {
        // gateway 起动时 ApiState 为 None，bootstrap 完成前请求会得到 503
        let state: ApiState = Arc::new(Mutex::new(None));
        assert!(state.lock().is_none());
    }

    #[test]
    fn api_state_fills_after_bootstrap() {
        // bootstrap 完成后写入，后续请求读到非 None
        let state: ApiState = Arc::new(Mutex::new(None));
        *state.lock() = Some(BootstrapAuthResp {
            token: "t".into(),
            user_id: "u".into(),
        });
        assert!(state.lock().is_some());
    }
}
