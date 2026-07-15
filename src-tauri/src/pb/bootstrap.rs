//! 首启初始化：确保 superuser + local-user，返回用户 token（缓存到 OS keychain）。
//!
//! 调用前提：PocketBase 已通过 `spawn_pocketbase` 启动，且 superuser 已由 CLI
//! `superuser upsert` 创建（见 lib.rs 中的 `create_superuser_via_sidecar`）。
use serde::Serialize;
use serde_json::{json, Value};

/// 首启认证结果，供应用全局共享。
pub struct BootstrapAuth {
    pub base_url: String,
    pub token: String,
    pub user_id: String,
}

/// superuser 邮箱（固定，不对外暴露）。
const SUPERUSER_EMAIL: &str = "local@app.internal";
/// 本地唯一用户邮箱。
const LOCAL_EMAIL: &str = "you@local.rework";
/// keychain 服务名称。
const KEYRING_SERVICE: &str = "rework";

/// 公开：获取 superuser 密码（供 lib.rs 在启动 CLI 时使用）。
pub fn superuser_password() -> String {
    get_or_make_secret("superuser-pw")
}

/// 从 keychain 读取密码；若不存在则随机生成并写入。
fn get_or_make_secret(account: &str) -> String {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, account) {
        if let Ok(pw) = entry.get_password() {
            return pw;
        }
        // 首次生成随机密码并持久化
        let pw: String = {
            use rand::Rng;
            rand::thread_rng()
                .sample_iter(&rand::distributions::Alphanumeric)
                .take(32)
                .map(char::from)
                .collect()
        };
        let _ = entry.set_password(&pw);
        return pw;
    }
    // keychain 不可用时的硬编码回退（开发/CI 场景）
    "rework-fallback-pass-please-rotate".into()
}

/// 核心入口：幂等地确保 superuser + local-user，返回 local-user 的 token。
///
/// - 如果 superuser 尚未创建（首次启动），调用方须先执行 `superuser upsert`（见 lib.rs）。
/// - 如果 local-user 已存在则直接登录；否则先创建再登录。
/// - token 同时写入 keychain（account: `local-user-token`）。
pub async fn bootstrap(base_url: &str) -> anyhow::Result<BootstrapAuth> {
    let http = reqwest::Client::new();
    let super_pw = get_or_make_secret("superuser-pw");
    let user_pw = get_or_make_secret("local-user-pw");

    // 1) 以 superuser 身份登录，获取管理员 token
    let admin_token = admin_login(&http, base_url, SUPERUSER_EMAIL, &super_pw).await?;

    // 2) 确保 local-user 存在，返回其 id
    let user_id = ensure_user(&http, base_url, &admin_token, LOCAL_EMAIL, &user_pw).await?;

    // 3) 以 local-user 身份登录，获取用户 token
    let token = user_login(&http, base_url, LOCAL_EMAIL, &user_pw).await?;

    // 4) 将 token 写入 keychain 供复用
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, "local-user-token") {
        let _ = entry.set_password(&token);
    }

    Ok(BootstrapAuth {
        base_url: base_url.into(),
        token,
        user_id,
    })
}

/// 以 superuser 身份登录，返回管理员 JWT token。
async fn admin_login(
    http: &reqwest::Client,
    base: &str,
    email: &str,
    pw: &str,
) -> anyhow::Result<String> {
    #[derive(Serialize)]
    struct AuthBody<'a> {
        identity: &'a str,
        password: &'a str,
    }

    let r = http
        .post(format!("{base}/api/collections/_superusers/auth-with-password"))
        .json(&AuthBody { identity: email, password: pw })
        .send()
        .await?
        .error_for_status()?;
    let v: Value = r.json().await?;
    let token = v["token"].as_str().unwrap_or_default().to_string();
    if token.is_empty() {
        anyhow::bail!("superuser 登录返回空 token");
    }
    Ok(token)
}

/// 确保 local-user 存在（幂等）：已存在则直接返回 id，否则先创建。
async fn ensure_user(
    http: &reqwest::Client,
    base: &str,
    admin_token: &str,
    email: &str,
    pw: &str,
) -> anyhow::Result<String> {
    // 先查询是否已存在
    let existing = http
        .get(format!("{base}/api/collections/users/records"))
        .bearer_auth(admin_token)
        .query(&[("filter", format!("email='{email}'")), ("perPage", "1".into())])
        .send()
        .await?
        .error_for_status()?
        .json::<Value>()
        .await?;

    if let Some(u) = existing["items"].as_array().and_then(|a| a.first()) {
        return Ok(u["id"].as_str().unwrap_or_default().to_string());
    }

    // 不存在则创建
    let created = http
        .post(format!("{base}/api/collections/users/records"))
        .bearer_auth(admin_token)
        .json(&json!({
            "email": email,
            "password": pw,
            "passwordConfirm": pw,
            "displayName": "me"
        }))
        .send()
        .await?
        .error_for_status()?
        .json::<Value>()
        .await?;

    Ok(created["id"].as_str().unwrap_or_default().to_string())
}

/// 以 local-user 身份登录，返回用户 JWT token。
async fn user_login(
    http: &reqwest::Client,
    base: &str,
    email: &str,
    pw: &str,
) -> anyhow::Result<String> {
    #[derive(Serialize)]
    struct AuthBody<'a> {
        identity: &'a str,
        password: &'a str,
    }

    let r = http
        .post(format!("{base}/api/collections/users/auth-with-password"))
        .json(&AuthBody { identity: email, password: pw })
        .send()
        .await?
        .error_for_status()?;
    let v: Value = r.json().await?;
    let token = v["token"].as_str().unwrap_or_default().to_string();
    if token.is_empty() {
        anyhow::bail!("local-user 登录返回空 token");
    }
    Ok(token)
}
