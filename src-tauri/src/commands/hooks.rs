//! commands/hooks.rs —— rework 实时活动 hook：把 Claude Code 的 PostToolUse 全量工具流
//! 转发到 rework 的 /activity 端点（Phase 2）。
//!
//! 操作 `~/.claude/settings.json` 的 `hooks.PostToolUse`（JSON 结构，非 shell 文本块）：
//! **只增删 rework 自己那一条**（以命令串里的固定标记 `rework-activity` 识别），
//! 用户其它所有 hooks 与设置逐字保留。幂等：重复 install 不产生重复条目。
use serde_json::{json, Value};
use tauri::Manager;

/// rework hook 命令里的固定标记，用于识别「哪条是我们的」。
/// 作为一个额外的 curl 参数出现（`--user-agent rework-activity`），既不影响转发，
/// 又能被 `is_rework_hook` 稳定识别，且用户其它 hook 命令不会误含此串。
const HOOK_MARKER: &str = "rework-activity";

/// hook 命令版本：命令结构/端点逻辑变更时 +1。
/// 已装 hook 的命令里带 `rework-activity/<版本>`，据此检测是否过期需升级。
/// v2：命令末尾加 `|| exit 0`，rework 未开/连不上时 curl 非0退出不再报 hook error。
const HOOK_VERSION: u32 = 2;

// ——————————————————————————————————————————————————————————————————————
// 纯逻辑：settings.json 的 hooks.PostToolUse 受管条目增删（可测，无 IO）
// ——————————————————————————————————————————————————————————————————————

/// 判断一个 PostToolUse 分组是否是 rework 装的（其内含带标记的 command hook）。
fn is_rework_group(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter().any(|h| {
                h.get("command")
                    .and_then(|v| v.as_str())
                    .map(|c| c.contains(HOOK_MARKER))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// 构造 rework 的 PostToolUse 分组：matcher="*" + 一条带标记的 command hook。
/// command 已把 activity_url + secret 烘焙进去，从 stdin 转发 hook JSON。
fn rework_group(command: &str) -> Value {
    json!({
        "matcher": "*",
        "hooks": [ { "type": "command", "command": command } ]
    })
}

/// 在 settings JSON 中加入/更新 rework 的 PostToolUse 条目（幂等）。
/// - 逐字保留用户其它所有 hooks 与设置；
/// - 已存在 rework 条目则替换为新命令（端点/secret 可能变化），不产生重复；
/// - 若 hooks / hooks.PostToolUse 不存在则按 JSON 结构补齐。
/// 纯函数：接收并返回 JSON，便于单测。
pub fn add_activity_hook(mut root: Value, command: &str) -> Value {
    // 确保 root 是对象
    if !root.is_object() {
        root = json!({});
    }
    // 确保 hooks 是对象
    if !root.get("hooks").map(|v| v.is_object()).unwrap_or(false) {
        root["hooks"] = json!({});
    }
    // 确保 hooks.PostToolUse 是数组
    if !root["hooks"]
        .get("PostToolUse")
        .map(|v| v.is_array())
        .unwrap_or(false)
    {
        root["hooks"]["PostToolUse"] = json!([]);
    }
    let arr = root["hooks"]["PostToolUse"].as_array_mut().unwrap();
    // 先剔除所有已有 rework 分组（幂等：避免重复），再追加最新一条
    arr.retain(|g| !is_rework_group(g));
    arr.push(rework_group(command));
    root
}

/// 从 settings JSON 中移除 rework 的 PostToolUse 条目（保留用户其它一切）。
/// 若移除后 PostToolUse 为空数组则删除该键；若 hooks 变空对象则删除 hooks 键，保持整洁。
/// 纯函数：接收并返回 JSON，便于单测。
pub fn remove_activity_hook(mut root: Value) -> Value {
    if !root.is_object() {
        return root;
    }
    let Some(hooks) = root.get_mut("hooks").filter(|v| v.is_object()) else {
        return root;
    };
    if let Some(arr) = hooks.get_mut("PostToolUse").and_then(|v| v.as_array_mut()) {
        arr.retain(|g| !is_rework_group(g));
        let empty = arr.is_empty();
        if empty {
            hooks.as_object_mut().unwrap().remove("PostToolUse");
        }
    }
    // hooks 变空则删除 hooks 键
    if root["hooks"].as_object().map(|o| o.is_empty()).unwrap_or(false) {
        root.as_object_mut().unwrap().remove("hooks");
    }
    root
}

/// settings JSON 中是否已装 rework 的 activity hook。
pub fn has_activity_hook(root: &Value) -> bool {
    root.get("hooks")
        .and_then(|h| h.get("PostToolUse"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().any(is_rework_group))
        .unwrap_or(false)
}

// ——————————————————————————————————————————————————————————————————————
// 进程拦截 hook：PreToolUse(Bash) 自动托管长驻进程（标记 rework-intercept）
// ——————————————————————————————————————————————————————————————————————

/// 拦截 hook 命令里的固定标记（识别「哪条是我们的」）。
const INTERCEPT_MARKER: &str = "rework-intercept";

/// 判断一个 PreToolUse 分组是否是 rework 装的拦截 hook。
fn is_intercept_group(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter().any(|h| {
                h.get("command")
                    .and_then(|v| v.as_str())
                    .map(|c| c.contains(INTERCEPT_MARKER))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// 构造 rework 拦截分组：matcher="Bash" + 一条带标记的 command hook。
fn intercept_group(command: &str) -> Value {
    json!({
        "matcher": "Bash",
        "hooks": [ { "type": "command", "command": command } ]
    })
}

/// 在 settings JSON 中加入/更新 rework 的 PreToolUse(Bash) 拦截条目（幂等，保留用户其它一切）。
pub fn add_intercept_hook(mut root: Value, command: &str) -> Value {
    if !root.is_object() {
        root = json!({});
    }
    if !root.get("hooks").map(|v| v.is_object()).unwrap_or(false) {
        root["hooks"] = json!({});
    }
    if !root["hooks"]
        .get("PreToolUse")
        .map(|v| v.is_array())
        .unwrap_or(false)
    {
        root["hooks"]["PreToolUse"] = json!([]);
    }
    let arr = root["hooks"]["PreToolUse"].as_array_mut().unwrap();
    arr.retain(|g| !is_intercept_group(g));
    arr.push(intercept_group(command));
    root
}

/// 从 settings JSON 移除 rework 拦截条目（保留用户其它一切；清空则删键）。
pub fn remove_intercept_hook(mut root: Value) -> Value {
    if !root.is_object() {
        return root;
    }
    let Some(hooks) = root.get_mut("hooks").filter(|v| v.is_object()) else {
        return root;
    };
    if let Some(arr) = hooks.get_mut("PreToolUse").and_then(|v| v.as_array_mut()) {
        arr.retain(|g| !is_intercept_group(g));
        if arr.is_empty() {
            hooks.as_object_mut().unwrap().remove("PreToolUse");
        }
    }
    if root["hooks"].as_object().map(|o| o.is_empty()).unwrap_or(false) {
        root.as_object_mut().unwrap().remove("hooks");
    }
    root
}

/// settings JSON 中是否已装 rework 拦截 hook。
pub fn has_intercept_hook(root: &Value) -> bool {
    root.get("hooks")
        .and_then(|h| h.get("PreToolUse"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().any(is_intercept_group))
        .unwrap_or(false)
}

/// 组装拦截 hook 命令：curl 从 stdin 转发 hook JSON 到 /intercept，把决策 JSON 打回 stdout。
/// -m 8：托管进程可能需数秒，给足超时；--user-agent 携带标记便于识别。
fn build_intercept_command(intercept_url: &str, secret: &str) -> String {
    // 末尾 `|| exit 0`：rework 未开时 curl 连不上会非0退出并报 hook error；
    // 静默退 0 → 空 stdout → Claude 视作放行（正确降级：daemon 不在就正常跑命令）。
    format!(
        "curl -s -m 8 -X POST -H \"Authorization: Bearer {secret}\" -H \"Content-Type: application/json\" --user-agent {INTERCEPT_MARKER}/2 --data-binary @- {intercept_url} || exit 0"
    )
}

// ——————————————————————————————————————————————————————————————————————
// IO：读端点 + 组命令 + 读写 ~/.claude/settings.json
// ——————————————————————————————————————————————————————————————————————

/// 从 app_data_dir/mcp-endpoint.json 读 { url, secret }，把 url 的 `/mcp` 换成 `/activity`。
fn read_activity_endpoint(app: &tauri::AppHandle) -> Result<(String, String), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("mcp-endpoint.json");
    let body = std::fs::read_to_string(&path)
        .map_err(|_| "MCP 端点未就绪（应用可能刚启动，请稍候重试）".to_string())?;
    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let url = v["url"].as_str().ok_or("端点缺 url")?.to_string();
    let secret = v["secret"].as_str().ok_or("端点缺 secret")?.to_string();
    // /mcp → /activity（端点文件里 url 固定以 /mcp 结尾）
    let activity_url = if let Some(base) = url.strip_suffix("/mcp") {
        format!("{base}/activity")
    } else {
        // 兜底：直接追加（正常不会走到）
        format!("{}/activity", url.trim_end_matches('/'))
    };
    Ok((activity_url, secret))
}

/// 读端点并拼出 /intercept 的完整 url（+ secret），供拦截 hook 命令使用。
fn read_intercept_endpoint(app: &tauri::AppHandle) -> Result<(String, String), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("mcp-endpoint.json");
    let body = std::fs::read_to_string(&path)
        .map_err(|_| "MCP 端点未就绪（应用可能刚启动，请稍候重试）".to_string())?;
    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let url = v["url"].as_str().ok_or("端点缺 url")?.to_string();
    let secret = v["secret"].as_str().ok_or("端点缺 secret")?.to_string();
    let intercept_url = if let Some(base) = url.strip_suffix("/mcp") {
        format!("{base}/intercept")
    } else {
        format!("{}/intercept", url.trim_end_matches('/'))
    };
    Ok((intercept_url, secret))
}

/// 组装 rework 的 hook 命令：用 curl 从 stdin 转发 hook JSON 到 /activity 端点。
/// - `-s` 静默、`-m 2` 2 秒超时防卡、`--data-binary @-` 读 stdin 原样转发；
/// - `--user-agent rework-activity` 携带标记便于识别本条 hook；
/// - Windows 10+/mac/linux 均自带 curl(.exe)。
fn build_hook_command(activity_url: &str, secret: &str) -> String {
    // user-agent 带版本（rework-activity/<n>）：既是识别标记，又供 installed_hook_version 判过期。
    // 末尾 `|| exit 0`：rework 未开时 curl 连不上会非0退出，Claude 会报 "hook error"；
    // 尽力上报本就不该打扰用户，失败一律静默退 0（cmd/sh 均支持 || 与 exit 0）。
    format!(
        "curl -s -m 2 -X POST -H \"Authorization: Bearer {secret}\" -H \"Content-Type: application/json\" --user-agent {HOOK_MARKER}/{HOOK_VERSION} --data-binary @- {activity_url} || exit 0"
    )
}

/// 解析已装 rework hook 命令里的版本号（`rework-activity/<n>`）。
/// 有 rework 条目但无版本 token（旧版）→ Some(0)；根本没装 → None。
fn installed_hook_version(root: &Value) -> Option<u32> {
    let arr = root.get("hooks")?.get("PostToolUse")?.as_array()?;
    let group = arr.iter().find(|g| is_rework_group(g))?;
    let cmd = group
        .get("hooks")?
        .as_array()?
        .iter()
        .find_map(|h| h.get("command").and_then(|v| v.as_str()))?;
    let tag = format!("{HOOK_MARKER}/");
    match cmd.find(&tag) {
        Some(idx) => {
            let rest = &cmd[idx + tag.len()..];
            let num: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            Some(num.parse::<u32>().unwrap_or(0))
        }
        None => Some(0), // 有 rework 条目但无版本 = 旧版
    }
}

/// 读 ~/.claude/settings.json（不存在则空对象）。
fn read_claude_settings() -> Result<(std::path::PathBuf, Value), String> {
    let home = dirs::home_dir().ok_or("找不到用户主目录")?;
    let path = home.join(".claude").join("settings.json");
    let root: Value = if path.exists() {
        let s = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&s).map_err(|e| format!("~/.claude/settings.json 解析失败：{e}"))?
    } else {
        json!({})
    };
    Ok((path, root))
}

/// 写回 settings.json（pretty，2 空格缩进；补末尾换行）。写前建父目录。
fn write_claude_settings(path: &std::path::Path, root: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut out = serde_json::to_string_pretty(root).map_err(|e| e.to_string())?;
    out.push('\n');
    std::fs::write(path, out).map_err(|e| e.to_string())?;
    Ok(())
}

// ——————————————————————————————————————————————————————————————————————
// Tauri 命令
// ——————————————————————————————————————————————————————————————————————

/// 实时活动 hook 状态（供前端展示）。
#[derive(serde::Serialize)]
pub struct ActivityHookStatus {
    pub installed: bool,
    /// 已装且为当前版本。installed 但 up_to_date=false 表示装了但过期，需升级（一键重装即可）。
    pub up_to_date: bool,
}

/// 查询 ~/.claude/settings.json 的 rework 实时活动 hook 状态（是否安装 + 是否当前版本）。
#[tauri::command]
pub fn activity_hook_status() -> ActivityHookStatus {
    match read_claude_settings() {
        Ok((_, root)) => {
            let installed = has_activity_hook(&root);
            // 已装且版本号等于当前 = 最新；旧版本/无版本 = 过期需升级
            let up_to_date = installed && installed_hook_version(&root) == Some(HOOK_VERSION);
            ActivityHookStatus {
                installed,
                up_to_date,
            }
        }
        // 读失败（无文件/解析错）一律视作未安装
        Err(_) => ActivityHookStatus {
            installed: false,
            up_to_date: false,
        },
    }
}

/// 安装：把 rework 的 PostToolUse 条目写入 ~/.claude/settings.json（幂等、保留用户其它设置）。
/// 命令里烘焙当前端点 url + secret。
#[tauri::command]
pub fn install_activity_hook(app: tauri::AppHandle) -> Result<(), String> {
    let (activity_url, secret) = read_activity_endpoint(&app)?;
    let command = build_hook_command(&activity_url, &secret);
    let (path, root) = read_claude_settings()?;
    let next = add_activity_hook(root, &command);
    write_claude_settings(&path, &next)
}

/// 卸载：只移除 rework 自己那一条 PostToolUse 条目，用户其它设置逐字保留。
#[tauri::command]
pub fn uninstall_activity_hook() -> Result<(), String> {
    let (path, root) = read_claude_settings()?;
    // 无 hook 也算成功（幂等）
    if !has_activity_hook(&root) {
        return Ok(());
    }
    let next = remove_activity_hook(root);
    write_claude_settings(&path, &next)
}

/// 查询 ~/.claude/settings.json 的进程拦截 hook 是否已安装。
#[tauri::command]
pub fn intercept_hook_status() -> bool {
    read_claude_settings()
        .map(|(_, root)| has_intercept_hook(&root))
        .unwrap_or(false)
}

/// 安装：把 PreToolUse(Bash) 拦截条目写入 ~/.claude/settings.json（幂等、保留用户其它设置）。
#[tauri::command]
pub fn install_intercept_hook(app: tauri::AppHandle) -> Result<(), String> {
    let (intercept_url, secret) = read_intercept_endpoint(&app)?;
    let command = build_intercept_command(&intercept_url, &secret);
    let (path, root) = read_claude_settings()?;
    let next = add_intercept_hook(root, &command);
    write_claude_settings(&path, &next)
}

/// 卸载：只移除 rework 自己那一条 PreToolUse 拦截条目，用户其它设置逐字保留。
#[tauri::command]
pub fn uninstall_intercept_hook() -> Result<(), String> {
    let (path, root) = read_claude_settings()?;
    if !has_intercept_hook(&root) {
        return Ok(());
    }
    let next = remove_intercept_hook(root);
    write_claude_settings(&path, &next)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CMD: &str = "curl -s --user-agent rework-activity http://x/activity";

    #[test]
    fn add_creates_structure_and_is_idempotent() {
        // 空对象起步：补齐 hooks.PostToolUse 并加入一条
        let root = add_activity_hook(json!({}), CMD);
        assert!(has_activity_hook(&root));
        let arr = root["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(arr.len(), 1);

        // 重复 add：不产生重复条目（仍只有 1 条 rework 分组）
        let root2 = add_activity_hook(root, CMD);
        let arr2 = root2["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(arr2.len(), 1, "重复 install 不应产生重复条目");
    }

    #[test]
    fn add_preserves_user_hooks_and_settings() {
        // 用户已有：一个自定义 PostToolUse 分组 + 一个 PreToolUse 分组 + 其它设置
        let user = json!({
            "model": "opus",
            "hooks": {
                "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "echo pre" } ] } ],
                "PostToolUse": [ { "matcher": "Edit", "hooks": [ { "type": "command", "command": "echo user-post" } ] } ]
            },
            "customKey": [1, 2, 3]
        });
        let root = add_activity_hook(user, CMD);

        // 用户顶层设置逐字保留
        assert_eq!(root["model"], "opus");
        assert_eq!(root["customKey"], json!([1, 2, 3]));
        // PreToolUse 未被触碰
        assert_eq!(
            root["hooks"]["PreToolUse"][0]["hooks"][0]["command"],
            "echo pre"
        );
        // 用户的 PostToolUse 条目仍在，且新增了 rework 一条
        let post = root["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post.len(), 2, "用户既有 PostToolUse 条目应保留 + rework 新增");
        assert!(post.iter().any(|g| g["hooks"][0]["command"] == "echo user-post"));
        assert!(has_activity_hook(&root));
    }

    #[test]
    fn remove_only_strips_rework_entry() {
        let user = json!({
            "hooks": {
                "PostToolUse": [ { "matcher": "Edit", "hooks": [ { "type": "command", "command": "echo user-post" } ] } ]
            }
        });
        let installed = add_activity_hook(user, CMD);
        assert!(has_activity_hook(&installed));

        let removed = remove_activity_hook(installed);
        assert!(!has_activity_hook(&removed));
        // 用户的 PostToolUse 条目仍在
        let post = removed["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post.len(), 1);
        assert_eq!(post[0]["hooks"][0]["command"], "echo user-post");
    }

    #[test]
    fn remove_cleans_empty_keys() {
        // 只有 rework 一条时，移除后应删空的 PostToolUse 与 hooks 键
        let root = add_activity_hook(json!({}), CMD);
        let removed = remove_activity_hook(root);
        assert!(removed.get("hooks").is_none(), "hooks 变空应删除");
    }

    #[test]
    fn remove_on_missing_is_noop() {
        // 从没装过 → 移除不报错、不改动
        let user = json!({ "model": "opus" });
        let out = remove_activity_hook(user.clone());
        assert_eq!(out, user);
    }

    #[test]
    fn add_replaces_stale_rework_entry() {
        // 已有旧端点的 rework 条目 → 再 install 应替换为新命令（仍只 1 条）
        let old_cmd = "curl -s --user-agent rework-activity http://OLD/activity";
        let root = add_activity_hook(json!({}), old_cmd);
        let new_cmd = "curl -s --user-agent rework-activity http://NEW/activity";
        let root2 = add_activity_hook(root, new_cmd);
        let arr = root2["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["hooks"][0]["command"], new_cmd);
    }

    #[test]
    fn version_detects_drift() {
        // 当前版本命令 → 版本号等于 HOOK_VERSION
        let cur = build_hook_command("http://127.0.0.1:47600/activity", "s");
        let root = add_activity_hook(json!({}), &cur);
        assert_eq!(installed_hook_version(&root), Some(HOOK_VERSION));
        // 无版本 token 的旧命令 → Some(0)（过期）
        let old = "curl -s --user-agent rework-activity http://OLD/activity";
        let root2 = add_activity_hook(json!({}), old);
        assert_eq!(installed_hook_version(&root2), Some(0));
        // 没装 → None
        assert_eq!(installed_hook_version(&json!({})), None);
    }

    #[test]
    fn build_hook_command_shape() {
        let cmd = build_hook_command("http://127.0.0.1:47600/activity", "sekret");
        assert!(cmd.contains("curl -s -m 2 -X POST"));
        assert!(cmd.contains("Authorization: Bearer sekret"));
        assert!(cmd.contains("--data-binary @-"));
        assert!(cmd.contains(HOOK_MARKER));
        assert!(cmd.contains("http://127.0.0.1:47600/activity"));
        // 末尾静默退 0，避免 rework 未开时报 hook error
        assert!(cmd.trim_end().ends_with("|| exit 0"));
    }

    const ICMD: &str = "curl -s --user-agent rework-intercept http://x/intercept";

    #[test]
    fn intercept_and_activity_coexist_independently() {
        // 先装 activity(PostToolUse)，再装 intercept(PreToolUse)：两者共存、互不干扰
        let root = add_activity_hook(json!({}), CMD);
        let root = add_intercept_hook(root, ICMD);
        assert!(has_activity_hook(&root));
        assert!(has_intercept_hook(&root));
        assert_eq!(root["hooks"]["PostToolUse"].as_array().unwrap().len(), 1);
        assert_eq!(root["hooks"]["PreToolUse"].as_array().unwrap().len(), 1);
        assert_eq!(root["hooks"]["PreToolUse"][0]["matcher"], "Bash");

        // 幂等：重复装 intercept 不产生重复
        let root = add_intercept_hook(root, ICMD);
        assert_eq!(root["hooks"]["PreToolUse"].as_array().unwrap().len(), 1);

        // 只卸 intercept：activity 保留
        let root = remove_intercept_hook(root);
        assert!(!has_intercept_hook(&root));
        assert!(has_activity_hook(&root), "卸拦截不应影响 activity");
    }

    #[test]
    fn intercept_preserves_user_pretooluse() {
        // 用户已有一个 PreToolUse(Bash) hook：装 intercept 后应保留用户那条
        let user = json!({
            "hooks": {
                "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "echo user-pre" } ] } ]
            }
        });
        let root = add_intercept_hook(user, ICMD);
        let arr = root["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(arr.len(), 2, "用户既有 PreToolUse + rework 拦截");
        assert!(arr.iter().any(|g| g["hooks"][0]["command"] == "echo user-pre"));
        // 卸载后用户那条仍在
        let root = remove_intercept_hook(root);
        let arr = root["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["hooks"][0]["command"], "echo user-pre");
    }
}
