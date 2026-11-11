use reqwest::Url;
mod state;
pub use state::MobileState;

fn validate_host(host: &str) -> Result<Url, String> {
    let invalid = || "主机必须是 HTTPS 根地址，不可包含用户名、路径、查询或片段".to_string();
    // Check raw syntax as well: URL parsing normalizes dot paths and backslashes.
    let authority = host.strip_prefix("https://").ok_or_else(invalid)?;
    let authority = authority.strip_suffix('/').unwrap_or(authority);
    if authority.is_empty()
        || authority
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || "@/\\?#".contains(c))
    {
        return Err(invalid());
    }
    let url = Url::parse(host).map_err(|_| invalid())?;
    if url.host_str().is_none()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(invalid());
    }
    Ok(url)
}

fn valid_token(token: &str) -> bool {
    token.len() == 43
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn extract_token(headers: &reqwest::header::HeaderMap) -> Result<String, String> {
    let invalid = || "配对响应缺少有效凭据".to_string();
    let mut token = None;
    for header in headers.get_all(reqwest::header::SET_COOKIE) {
        let raw = header.to_str().map_err(|_| invalid())?;
        let pair = raw.split(';').next().unwrap_or("").trim();
        if let Some(value) = pair.strip_prefix("kln_token=") {
            if token.is_some() || !valid_token(value) {
                return Err(invalid());
            }
            token = Some(value.to_string());
        }
    }
    token.ok_or_else(invalid)
}

#[cfg(feature = "shell")]
mod shell;
#[cfg(feature = "shell")]
pub use shell::run;

use reqwest::{Client, Request, StatusCode};
use serde_json::{json, Value};
use std::time::Duration;

const AUTH_REQUIRED: &str = "AUTH_REQUIRED: 请重新配对主机";

struct Connection {
    host: Url,
    token: String,
}

/// Credentials are private, memory-only, and never serialized or logged.
pub struct MobileClient {
    http: Client,
    connection: Option<Connection>,
}

impl MobileClient {
    pub fn new() -> Result<Self, String> {
        let http = Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .user_agent("Keelson-Mobile/0.1")
            .build()
            .map_err(|_| "无法初始化 HTTPS 客户端".to_string())?;
        Ok(Self {
            http,
            connection: None,
        })
    }

    pub fn disconnect(&mut self) {
        self.connection = None;
    }

    fn pair_request(&self, host: &Url, code: &str) -> Result<Request, String> {
        self.http
            .post(host.join("/pair").map_err(|_| "无效主机地址")?)
            .json(&json!({"code": code}))
            .build()
            .map_err(|_| "无法创建配对请求".into())
    }

    pub async fn pair(&mut self, host: &str, code: &str) -> Result<(), String> {
        self.disconnect();
        let host = validate_host(host)?;
        if code.trim().is_empty() {
            return Err("请输入配对码".into());
        }
        let response = self
            .http
            .execute(self.pair_request(&host, code)?)
            .await
            .map_err(|_| "无法连接主机，请检查网络及 HTTPS 证书".to_string())?;
        self.check_status(response.status())?;
        let token = extract_token(response.headers())?;
        self.connection = Some(Connection { host, token });
        Ok(())
    }

    fn api_request(&self, path: &str, body: Value) -> Result<Request, String> {
        let connection = self.connection.as_ref().ok_or(AUTH_REQUIRED)?;
        let mut cookie =
            reqwest::header::HeaderValue::from_str(&format!("kln_token={}", connection.token))
                .map_err(|_| AUTH_REQUIRED)?;
        cookie.set_sensitive(true);
        self.http
            .post(connection.host.join(path).map_err(|_| "无效请求路径")?)
            .header(reqwest::header::COOKIE, cookie)
            .json(&body)
            .build()
            .map_err(|_| "无法创建会话请求".into())
    }

    fn check_status(&mut self, status: StatusCode) -> Result<(), String> {
        match status {
            StatusCode::UNAUTHORIZED => {
                self.disconnect();
                Err(AUTH_REQUIRED.into())
            }
            StatusCode::FORBIDDEN => Err("FEATURE_DISABLED: 主机已关闭此功能".into()),
            s if s.is_success() => Ok(()),
            s if s.is_redirection() => Err("主机返回重定向，请直接使用正确的 HTTPS 根地址".into()),
            s => Err(format!("主机请求失败（HTTP {}）", s.as_u16())),
        }
    }

    async fn api(&mut self, path: &str, body: Value) -> Result<Value, String> {
        let response = self
            .http
            .execute(self.api_request(path, body)?)
            .await
            .map_err(|_| "无法连接主机，请检查网络及 HTTPS 证书".to_string())?;
        self.check_status(response.status())?;
        response
            .json()
            .await
            .map_err(|_| "主机返回了无效的会话数据".into())
    }

    pub async fn sessions(&mut self) -> Result<Value, String> {
        self.api("/api/sessions_list", json!({})).await
    }

    pub async fn timeline(&mut self, provider: &str, session_id: &str) -> Result<Value, String> {
        self.api(
            "/api/sessions_timeline",
            json!({"provider": provider, "sessionId": session_id}),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn failed_repair_and_disconnect_forget_old_credentials() {
        let mut client = MobileClient::new().unwrap();
        client.connection = Some(Connection {
            host: validate_host("https://old.example").unwrap(),
            token: "a".repeat(43),
        });
        assert!(client.pair("http://new.example", "code").await.is_err());
        assert!(client
            .sessions()
            .await
            .unwrap_err()
            .starts_with("AUTH_REQUIRED:"));
        client.disconnect();
        assert!(client
            .timeline("claude", "id")
            .await
            .unwrap_err()
            .starts_with("AUTH_REQUIRED:"));
    }
    #[test]
    fn gateway_requests_have_exact_wire_contract_and_status_handling() {
        let mut client = MobileClient::new().unwrap();
        let host = validate_host("https://host.example:9443").unwrap();
        let pair = client.pair_request(&host, "secret").unwrap();
        assert_eq!(pair.method(), reqwest::Method::POST);
        assert_eq!(pair.url().as_str(), "https://host.example:9443/pair");
        assert!(pair.headers().get("cookie").is_none());
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(pair.body().unwrap().as_bytes().unwrap())
                .unwrap(),
            serde_json::json!({"code":"secret"})
        );
        client.connection = Some(Connection {
            host,
            token: "a".repeat(43),
        });
        let req = client
            .api_request(
                "/api/sessions_timeline",
                serde_json::json!({"provider":"claude","sessionId":"a/b"}),
            )
            .unwrap();
        assert_eq!(req.method(), reqwest::Method::POST);
        assert_eq!(req.url().path(), "/api/sessions_timeline");
        assert_eq!(
            req.headers()["cookie"],
            format!("kln_token={}", "a".repeat(43))
        );
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(req.body().unwrap().as_bytes().unwrap())
                .unwrap()["sessionId"],
            "a/b"
        );
        assert!(client
            .check_status(reqwest::StatusCode::FORBIDDEN)
            .unwrap_err()
            .starts_with("FEATURE_DISABLED:"));
        assert!(client.connection.is_some());
        assert!(client.check_status(reqwest::StatusCode::FOUND).is_err());
        assert!(client
            .check_status(reqwest::StatusCode::UNAUTHORIZED)
            .unwrap_err()
            .starts_with("AUTH_REQUIRED:"));
        assert!(client.connection.is_none());
    }
    #[test]
    fn cookie_accepts_only_one_valid_gateway_token() {
        use reqwest::header::{HeaderMap, HeaderValue, SET_COOKIE};
        let token = "a".repeat(43);
        let mut headers = HeaderMap::new();
        headers.append(SET_COOKIE, HeaderValue::from_static("other=x; Path=/"));
        assert!(extract_token(&headers).is_err());
        headers.append(
            SET_COOKIE,
            HeaderValue::from_str(&format!("kln_token={token}; Secure; HttpOnly; Path=/")).unwrap(),
        );
        assert_eq!(extract_token(&headers).unwrap(), token);
        headers.append(
            SET_COOKIE,
            HeaderValue::from_static("kln_token=bad; Path=/"),
        );
        assert!(extract_token(&headers).is_err());
        for bad in ["", "abc", "a; injected=yes", "a b", "a\r\nb"] {
            assert!(!valid_token(bad));
        }
    }
    #[test]
    fn accepts_only_https_root_origins() {
        assert_eq!(
            validate_host("https://example.com:9443").unwrap().as_str(),
            "https://example.com:9443/"
        );
        for host in [
            "http://example.com",
            "https://u:p@example.com",
            "https://example.com/path",
            "https://example.com/?a",
            "https://example.com/#a",
            "https://example.com/a/..",
            "https://example.com\\evil",
            "https://@example.com",
        ] {
            assert!(validate_host(host).is_err(), "accepted {host}");
        }
    }
}
