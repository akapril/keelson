//! commands/mcp.rs —— 把 rework MCP server 一键接入 claude / codex 客户端配置。
//! 读应用写的 mcp-endpoint.json（url + secret），安全合并进用户的客户端配置文件，
//! 只增改 rework 一项、保留其它内容，写前备份。
use serde_json::{json, Value};
use tauri::Manager;

/// 从端点文件读取当前 url + secret。
fn read_endpoint(app: &tauri::AppHandle) -> Result<(String, String), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("mcp-endpoint.json");
    let body = std::fs::read_to_string(&path)
        .map_err(|_| "MCP 端点未就绪（应用可能刚启动，请稍候重试）".to_string())?;
    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let url = v["url"].as_str().ok_or("端点缺 url")?.to_string();
    let secret = v["secret"].as_str().ok_or("端点缺 secret")?.to_string();
    Ok((url, secret))
}

/// 返回当前 MCP 端点 url（供设置页展示）。
/// 不返回 secret：前端只展示 url，secret 仅后端 hooks/mcp 安装时从端点文件读，
/// 避免 secret 暴露到 WebView JS 运行时（XSS 可读）。
#[tauri::command]
pub fn mcp_endpoint(app: tauri::AppHandle) -> Result<Value, String> {
    let (url, _secret) = read_endpoint(&app)?;
    Ok(json!({ "url": url }))
}

/// 一键接入 Claude Code：把 rework 写入 ~/.claude.json 的 mcpServers（HTTP + Bearer）。
#[tauri::command]
pub fn mcp_install_claude(app: tauri::AppHandle) -> Result<String, String> {
    let (url, secret) = read_endpoint(&app)?;
    let home = dirs::home_dir().ok_or("找不到用户主目录")?;
    let path = home.join(".claude.json");

    // 读现有配置（大文件，含 claude 全部状态）；不存在则空对象。
    let mut root: Value = if path.exists() {
        let s = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&s).map_err(|e| format!("~/.claude.json 解析失败：{e}"))?
    } else {
        json!({})
    };

    // 写前备份，防意外损坏用户 claude 配置。备份失败则告警（不静默）。
    if path.exists() {
        if let Err(e) = std::fs::copy(&path, home.join(".claude.json.rework-bak")) {
            eprintln!("[rework/mcp] 备份 ~/.claude.json 失败，仍将继续写入：{e}");
        }
    }

    // 只设 mcpServers.rework 一项，保留其它服务器与全部其它键。
    if !root.get("mcpServers").map(|v| v.is_object()).unwrap_or(false) {
        root["mcpServers"] = json!({});
    }
    root["mcpServers"]["rework"] = json!({
        "type": "http",
        "url": url,
        "headers": { "Authorization": format!("Bearer {secret}") }
    });

    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(&path, out).map_err(|e| e.to_string())?;
    Ok(format!("已接入 Claude Code：{}", path.display()))
}

/// 一键接入 Codex：把 [mcp_servers.rework] 写入 ~/.codex/config.toml（HTTP + Bearer 头）。
#[tauri::command]
pub fn mcp_install_codex(app: tauri::AppHandle) -> Result<String, String> {
    let (url, secret) = read_endpoint(&app)?;
    let home = dirs::home_dir().ok_or("找不到用户主目录")?;
    let dir = home.join(".codex");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("config.toml");

    // 读现有 TOML（不存在则空表）。注意：toml 值往返会丢注释/顺序，故先备份。
    let mut doc: toml::Value = if path.exists() {
        let s = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        toml::from_str(&s).map_err(|e| format!("~/.codex/config.toml 解析失败：{e}"))?
    } else {
        toml::Value::Table(toml::map::Map::new())
    };
    if path.exists() {
        if let Err(e) = std::fs::copy(&path, dir.join("config.toml.rework-bak")) {
            eprintln!("[rework/mcp] 备份 ~/.codex/config.toml 失败，仍将继续写入：{e}");
        }
    }

    // 确保 [mcp_servers] 表，只设 rework 一项。
    let tbl = doc.as_table_mut().ok_or("config.toml 顶层不是 table")?;
    let servers = tbl
        .entry("mcp_servers".to_string())
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
    let servers_tbl = servers.as_table_mut().ok_or("mcp_servers 不是 table")?;

    let mut headers = toml::map::Map::new();
    headers.insert(
        "Authorization".into(),
        toml::Value::String(format!("Bearer {secret}")),
    );
    let mut rework = toml::map::Map::new();
    rework.insert("url".into(), toml::Value::String(url));
    rework.insert("http_headers".into(), toml::Value::Table(headers));
    servers_tbl.insert("rework".into(), toml::Value::Table(rework));

    let out = toml::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    std::fs::write(&path, out).map_err(|e| e.to_string())?;
    Ok(format!("已接入 Codex：{}", path.display()))
}
