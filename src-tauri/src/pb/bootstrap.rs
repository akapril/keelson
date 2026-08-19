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
/// 本地唯一用户邮箱。改名 rework→keelson：由 pb_migrations 的 1784097300 迁移**就地**把现有
/// 用户邮箱改到此值（记录 id 不变 → owner 归属不变、数据不丢）。永不可见。
const LOCAL_EMAIL: &str = "you@local.keelson";
/// keychain 服务名称。改名 rework→keelson：启动时 `migrate_keyring()` 先把旧服务下的密钥
/// 拷到此新服务（否则读空会重生成、与 pb_data 用户密码对不上导致登录失败）。永不可见。
const KEYRING_SERVICE: &str = "keelson";
/// 旧 keychain 服务名（改名前）——仅供 `migrate_keyring` 迁移读取。
const OLD_KEYRING_SERVICE: &str = "rework";

/// 一次性把旧 keyring 服务名下的密钥拷贝到新服务名（identifier 改名兼容）。
/// 覆盖全部账户；幂等（新服务已有该账户则跳过）；best-effort（失败即忽略，回退文件/重生成）。
/// **必须在读取任何密钥（get_passwords）之前调用**（见 lib.rs run 开头）。
pub fn migrate_keyring() {
    // local-user-token 不含在内：它只是无人读取的缓存（bootstrap 每次重新登录），改走文件，不再进 keychain。
    for account in ["superuser-pw", "local-user-pw", "mcp-secret"] {
        // 文件回退已有该值 → 稳态启动直接走文件，无需任何 keychain 访问（避免 macOS 弹窗）。
        if read_secret_file(account).is_some() {
            continue;
        }
        let Ok(new) = keyring::Entry::new(KEYRING_SERVICE, account) else {
            continue;
        };
        if let Ok(v) = new.get_password() {
            let _ = write_secret_file(account, &v); // 顺带落文件，下次启动即走文件、不再弹
            continue; // 新服务已有 → 已迁移 / 无需动
        }
        if let Ok(old) = keyring::Entry::new(OLD_KEYRING_SERVICE, account) {
            if let Ok(v) = old.get_password() {
                let _ = new.set_password(&v);
                let _ = write_secret_file(account, &v); // 迁移同时落文件，后续无需再读 keychain
            }
        }
    }
}
/// 应用标识符（同 tauri.conf.json 的 identifier），用于还原 app_data_dir 做文件回退。
const APP_IDENTIFIER: &str = "com.keelson.app";

/// 公开：一次性获取 superuser 密码和本地用户密码（供 lib.rs 统一调用）。
/// 保证每次启动只调用一次 keychain，避免多处调用导致的不一致。
pub fn get_passwords() -> (String, String) {
    let super_pw = get_or_make_secret("superuser-pw");
    let user_pw = get_or_make_secret("local-user-pw");
    (super_pw, user_pw)
}

/// 生成 32 字符随机字母数字密码。
fn random_pw() -> String {
    use rand::Rng;
    rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

/// 幂等地获取某个 secret（如 mcp-secret / superuser-pw / local-user-pw）：
/// 读取优先级 **文件回退 → keychain**；两者都没有时才生成新值并同时写回，保证「已存在即复用、
/// 缺失才生成」，从而跨重启稳定。
///
/// 为什么文件优先（macOS 弹窗）：ad-hoc 签名（signingIdentity:"-"）下 macOS 每次访问 keychain
/// 都可能弹密码，且「始终允许」的授权绑定到代码签名、每次应用更新即失效 → 反复弹。文件回退在
/// **app 数据目录**（跨应用更新保留），文件优先可把稳态启动（文件已有值）的 keychain 弹窗降到零。
///
/// 背景（根因）：`keyring` v3 若未启用平台后端 feature（如 windows-native），会静默退化为
/// **内存 mock** 存储 —— 每次 `Entry::new` 都是全新空实例，`get_password` 必返回 NoEntry，
/// 于是每次启动都重新生成随机值、写入也随进程退出丢失，导致 secret 重启即变。现已在 Cargo.toml
/// 启用平台后端；同时加一层「仅当前用户可读」的文件回退，即便 keychain 不可用也能稳定持久化。
pub(crate) fn get_or_make_secret(account: &str) -> String {
    // 1) 优先读文件回退（app_data，读取零 keychain 弹窗；且跨应用更新保留）。命中直接返回。
    if let Some(pw) = read_secret_file(account) {
        return pw;
    }

    // 2) 文件缺失：读 keychain（平台真实持久存储 / 历史值）。命中则补写文件，之后启动即走文件、不再弹。
    let entry = keyring::Entry::new(KEYRING_SERVICE, account).ok();
    if let Some(e) = entry.as_ref() {
        if let Ok(pw) = e.get_password() {
            let _ = write_secret_file(account, &pw);
            return pw;
        }
    }

    // 3) 两处都没有：确属首次，生成新值并同时写入 keychain + 文件
    let pw = random_pw();
    let mut persisted = false;
    if let Some(e) = entry.as_ref() {
        if e.set_password(&pw).is_ok() {
            persisted = true;
        }
    }
    if write_secret_file(account, &pw).is_ok() {
        persisted = true;
    }
    if !persisted {
        // keychain 与文件都写失败：本次凭据无法跨启动持久化，明确告警
        eprintln!("[安全警告] 密钥链与文件回退均不可用，本次使用临时随机密码，凭据不会跨启动持久化");
    }
    pw
}

/// secret 文件回退目录：app_data_dir（与 mcp-endpoint.json 同目录）。
/// `get_or_make_secret` 无 Tauri 句柄，这里用 `dirs::config_dir()` + 应用标识符还原同一路径：
/// Windows 上即 `%APPDATA%/Roaming/com.keelson.app`，与 Tauri v2 的 `app_data_dir()` 一致。
fn secret_dir() -> Option<std::path::PathBuf> {
    let dir = dirs::config_dir()?.join(APP_IDENTIFIER).join("secrets");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// 读取某 account 的文件回退值（去除首尾空白）；不存在或读失败返回 None。
fn read_secret_file(account: &str) -> Option<String> {
    read_secret_file_in(&secret_dir()?, account)
}

/// 把某 account 的 secret 写入文件回退（仅当前用户可读）。
fn write_secret_file(account: &str, secret: &str) -> std::io::Result<()> {
    let dir = secret_dir().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "无法定位 secret 回退目录")
    })?;
    write_secret_file_in(&dir, account, secret)
}

/// 从指定目录读取某 account 的文件回退值（去除首尾空白）；不存在/空/读失败返回 None。
/// 抽出目录参数以便单测（真实 keychain 读写在测试进程里不可靠，只测文件回退路径）。
fn read_secret_file_in(dir: &std::path::Path, account: &str) -> Option<String> {
    let content = std::fs::read_to_string(dir.join(account)).ok()?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// 向指定目录写入某 account 的 secret（仅当前用户可读）。
/// Unix 下设 0o600 权限；Windows 下依赖用户目录 ACL（app_data_dir 本身即用户私有）。
fn write_secret_file_in(dir: &std::path::Path, account: &str, secret: &str) -> std::io::Result<()> {
    use std::io::Write;
    let path = dir.join(account);
    let mut f = std::fs::File::create(&path)?;
    f.write_all(secret.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// 文件回退路径的「已存在则复用、缺失才生成」纯逻辑（不碰 keychain）。
/// 供单测覆盖幂等性：同一目录+account 反复调用返回同一值。
#[cfg(test)]
fn get_or_make_secret_file_in(dir: &std::path::Path, account: &str) -> String {
    if let Some(pw) = read_secret_file_in(dir, account) {
        return pw;
    }
    let pw = random_pw();
    let _ = write_secret_file_in(dir, account, &pw);
    pw
}

/// 核心入口：幂等地确保 superuser + local-user，返回 local-user 的 token。
///
/// - `super_pw` 和 `user_pw` 由调用方（lib.rs）通过 `get_passwords()` 统一获取并传入，
///   保证整个启动流程中只有一处 keychain 调用，避免密码不一致。
/// - 如果 superuser 尚未创建（首次启动），调用方须先执行 `superuser upsert`（见 lib.rs）。
/// - 如果 local-user 已存在则直接登录；否则先创建再登录。
/// - token 同时写入 keychain（account: `local-user-token`）。
pub async fn bootstrap(base_url: &str, super_pw: &str, user_pw: &str) -> anyhow::Result<BootstrapAuth> {
    // 绕过代理：连本机 PB，防代理拦截 localhost 致 os error 10053（见 pb::local_http_client）
    let http = crate::pb::local_http_client();

    // 1) 以 superuser 身份登录，获取管理员 token
    let admin_token = admin_login(&http, base_url, SUPERUSER_EMAIL, super_pw).await?;

    // 2) 确保 local-user 存在，返回其 id
    let user_id = ensure_user(&http, base_url, &admin_token, LOCAL_EMAIL, user_pw).await?;

    // 3) 以 local-user 身份登录，获取用户 token
    let token = user_login(&http, base_url, LOCAL_EMAIL, user_pw).await?;

    // 4) 缓存 token 到文件回退供复用（不写 keychain：避免 macOS ad-hoc 下的写入弹窗；
    //    该缓存无人经 keychain 读取，bootstrap 每次都重新登录，文件缓存足矣）。
    let _ = write_secret_file("local-user-token", &token);

    Ok(BootstrapAuth {
        base_url: base_url.into(),
        token,
        user_id,
    })
}

/// 应用 PocketBase 日志保留天数（写入 `logs.maxDays`）。PB 据此自动裁剪旧请求日志，
/// 控制 auxiliary.db（日志库）增长。幂等；失败不致命（调用方仅记日志）。
pub async fn apply_log_retention(base: &str, super_pw: &str, days: u32) -> anyhow::Result<()> {
    // 绕过代理：连本机 PB（见 pb::local_http_client）
    let http = crate::pb::local_http_client();
    let admin_token = admin_login(&http, base, SUPERUSER_EMAIL, super_pw).await?;
    http.patch(format!("{base}/api/settings"))
        .bearer_auth(admin_token)
        .json(&serde_json::json!({ "logs": { "maxDays": days } }))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
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
        let id = u["id"].as_str().unwrap_or_default().to_string();
        if id.is_empty() {
            anyhow::bail!("查询已有用户时返回了空 id，响应数据异常");
        }
        // 用户已存在：重置密码为当前 keychain 中的值，防止因密码漂移导致登录失败。
        // 与 superuser upsert 逻辑保持一致，确保每次启动都能幂等地同步凭据。
        http.patch(format!("{base}/api/collections/users/records/{id}"))
            .bearer_auth(admin_token)
            .json(&json!({
                "password": pw,
                "passwordConfirm": pw
            }))
            .send()
            .await?
            .error_for_status()?;
        return Ok(id);
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

    let id = created["id"].as_str().unwrap_or_default().to_string();
    if id.is_empty() {
        anyhow::bail!("创建用户后返回了空 id，响应数据异常");
    }
    Ok(id)
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

// ——————————————————————————————————————————————————————————————————————
// 单元测试：只覆盖「文件回退」路径的幂等性（keychain 真实读写在测试进程里不可靠）。
// ——————————————————————————————————————————————————————————————————————
#[cfg(test)]
mod tests {
    use super::*;

    /// 缺失才生成：首次调用生成新值并落文件。
    #[test]
    fn file_fallback_generates_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let pw = get_or_make_secret_file_in(dir.path(), "mcp-secret");
        assert_eq!(pw.len(), 32, "生成的 secret 应为 32 字符");
        // 文件确实落盘
        assert_eq!(read_secret_file_in(dir.path(), "mcp-secret").as_deref(), Some(pw.as_str()));
    }

    /// 已存在则复用：同一目录+account 反复调用返回同一值（跨重启稳定的核心保证）。
    #[test]
    fn file_fallback_reuses_when_present() {
        let dir = tempfile::tempdir().unwrap();
        let first = get_or_make_secret_file_in(dir.path(), "mcp-secret");
        let second = get_or_make_secret_file_in(dir.path(), "mcp-secret");
        let third = get_or_make_secret_file_in(dir.path(), "mcp-secret");
        assert_eq!(first, second, "第二次应复用已存在值");
        assert_eq!(second, third, "第三次仍应复用已存在值");
    }

    /// 不同 account 互不干扰（mcp-secret / superuser-pw / local-user-token 各自独立）。
    #[test]
    fn file_fallback_isolates_accounts() {
        let dir = tempfile::tempdir().unwrap();
        let mcp = get_or_make_secret_file_in(dir.path(), "mcp-secret");
        let superpw = get_or_make_secret_file_in(dir.path(), "superuser-pw");
        assert_ne!(mcp, superpw, "不同 account 应各自独立生成");
        // 各自复用不串味
        assert_eq!(get_or_make_secret_file_in(dir.path(), "mcp-secret"), mcp);
        assert_eq!(get_or_make_secret_file_in(dir.path(), "superuser-pw"), superpw);
    }

    /// 写入后可原样读回（含 trim：空白/换行不影响命中）。
    #[test]
    fn file_read_write_roundtrip_and_trim() {
        let dir = tempfile::tempdir().unwrap();
        write_secret_file_in(dir.path(), "k", "abc123").unwrap();
        assert_eq!(read_secret_file_in(dir.path(), "k").as_deref(), Some("abc123"));
        // 手写带尾换行也应被 trim 后命中
        std::fs::write(dir.path().join("k2"), "xyz\n").unwrap();
        assert_eq!(read_secret_file_in(dir.path(), "k2").as_deref(), Some("xyz"));
        // 空文件视作不存在
        std::fs::write(dir.path().join("k3"), "   ").unwrap();
        assert_eq!(read_secret_file_in(dir.path(), "k3"), None);
        // 未写入的 account 返回 None
        assert_eq!(read_secret_file_in(dir.path(), "nope"), None);
    }
}
