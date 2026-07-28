// commands/web.rs — Web 领域命令。
// 1) 网页正文抓取（fetch_url_text，供阅读「AI 解析」）：抓取 URL → 粗提取可读正文
//    （去 script/style/标签、解实体、压空白、限长）→ 交前端喂给 AI 摘要。
// 2) Web Gateway 起停/状态（web_gateway_*，供「Web 端 + 外网访问」设置）：薄包装
//    crate::web::server，管理 AppState.web_gateway 句柄。
// 3) Web Gateway 认证/设备管理（web_pairing_code / web_regenerate_pairing_code /
//    web_list_devices / web_revoke_device，供 Task 5 设置栏展示与操作）。
use crate::AppState;
use crate::web::auth::DeviceInfo;
use std::time::Duration;
use tauri::State;

// ── Web Gateway 起停/状态命令 ─────────────────────────────────────────────
// 说明：gateway 绑 0.0.0.0（外网可达），认证在 Task 3 加；Task 1 仅健康路由。

/// 启动 Web Gateway（绑 0.0.0.0，端口由系统随机分配）。已在运行则返回现有端口（幂等）。
///
/// ⚠️ async command 里 `parking_lot::MutexGuard` 不能跨 await：
/// - 先在独立作用域取锁判断「是否已在运行」，命中则早返回；离开作用域即释放锁。
/// - bind（await）在锁外进行；成功后再取一次锁写回句柄。
#[tauri::command]
pub async fn web_gateway_start(state: State<'_, AppState>) -> Result<u16, String> {
    // 1) 已在运行则复用现有端口（取锁→读端口→立即释放，不跨 await）。
    {
        let guard = state.web_gateway.lock();
        if let Some(h) = guard.as_ref() {
            return Ok(h.port);
        }
    }
    // 2) 从 AppState.auth 取 PB base URL（PB 启动后才有值；未就绪则传空串，
    //    gateway 会将 /pb/* 请求 502 返回，不影响其他路由，不 panic）。
    //    取锁后立即 clone String 并释放锁，不跨 await 持锁。
    let pb_base: String = {
        let guard = state.auth.lock();
        guard
            .as_ref()
            .map(|a| a.base_url.clone())
            .unwrap_or_default()
    };

    // 3) 绑定 + 起 server（await 在锁外）。
    //    传入共享的 web_auth：gateway 认证中间件与设置栏（Task 5）用同一实例。
    //    传入 pb_base：供 /pb/* 反代路由使用（目标硬编码本机，防 SSRF）。
    //    传入 web_api_state：供 /api/bootstrap_auth 返回 PB token/userId（Task 7）。
    //    传入 sessions：供 /api/sessions_list 返回会话列表（Task 8，与 Tauri command 共享同一 Arc）。
    let (port, handle) = crate::web::server::start(
        0,
        state.web_auth.clone(),
        pb_base,
        state.web_api_state.clone(),
        state.sessions.clone(),
    ).await?;
    // 4) 写回句柄（重新取锁；此处已无 await）。
    //    极小概率并发下另一次调用已抢先写入：以先到者为准，本次多起的 server
    //    通过 drop handle（其 shutdown Sender drop）触发优雅关闭，避免端口泄漏。
    {
        let mut guard = state.web_gateway.lock();
        if let Some(existing) = guard.as_ref() {
            let existing_port = existing.port;
            drop(handle); // 触发本次多余 server 的优雅关闭
            return Ok(existing_port);
        }
        *guard = Some(handle);
    }
    Ok(port)
}

/// 停止 Web Gateway（若在运行）：取出句柄并发送优雅关闭信号。未运行则静默成功。
#[tauri::command]
pub fn web_gateway_stop(state: State<AppState>) -> Result<(), String> {
    // take() 取出 Option 内的句柄（GatewayHandle 非 Clone），send(()) 触发关闭。
    if let Some(h) = state.web_gateway.lock().take() {
        let _ = h.shutdown.send(());
    }
    Ok(())
}

/// 查询 Web Gateway 状态：运行中返回 `Some(port)`，未运行返回 `None`。
#[tauri::command]
pub fn web_gateway_status(state: State<AppState>) -> Result<Option<u16>, String> {
    Ok(state.web_gateway.lock().as_ref().map(|h| h.port))
}

// ── Web Gateway 认证 / 设备管理命令（Task 5 设置栏）────────────────────────

/// 读取当前配对码明文（供设置栏展示，让用户抄给待配对设备）。
///
/// ⚠️ 仅在受信本机 Tauri UI 中调用；配对码是外网入口凭据，切勿写日志。
#[tauri::command]
pub fn web_pairing_code(state: State<AppState>) -> Result<String, String> {
    Ok(crate::web::auth::current_pairing_code(&state.web_auth))
}

/// 手动轮换配对码：生成新随机码替换旧码，旧码立即失效，返回新码明文。
///
/// 用途：①用户想作废已泄露的码；②上一台配对完成后，手动为下一台刷新码。
/// 注意：`/pair` handler 完成一次配对后已自动轮换（`check_and_rotate`），
/// 此命令供用户在设置栏主动触发额外轮换。
#[tauri::command]
pub fn web_regenerate_pairing_code(state: State<AppState>) -> Result<String, String> {
    crate::web::auth::rotate_pairing_code(&state.web_auth);
    Ok(crate::web::auth::current_pairing_code(&state.web_auth))
}

/// 列出已配对设备（脱敏）：只返回 `{ id, label, paired_at }`，绝不下发 token_hash。
#[tauri::command]
pub fn web_list_devices(state: State<AppState>) -> Result<Vec<DeviceInfo>, String> {
    Ok(crate::web::auth::list_devices(&state.web_auth))
}

/// 吊销指定设备：从设备表移除其 token hash，该 token 立即失效。
///
/// id 不存在时为 no-op（幂等），不报错。
#[tauri::command]
pub fn web_revoke_device(state: State<AppState>, id: String) -> Result<(), String> {
    crate::web::auth::revoke(&state.web_auth, &id);
    Ok(())
}

// ── 网页正文抓取 ──────────────────────────────────────────────────────────


/// 送入 AI 的正文字符上限（控制 token/费用）。
const MAX_TEXT_CHARS: usize = 12000;

/// 抓取 URL 并返回粗提取的可读正文文本。
#[tauri::command]
pub async fn fetch_url_text(url: String) -> Result<String, String> {
    // 仅允许 http/https，拒绝 file:// 等（防本地文件读取 / SSRF）
    let lower = url.trim().to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("仅支持 http/https 链接".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (rework reader)")
        .build()
        .map_err(|e| format!("构建请求失败: {e}"))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("抓取失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let html = resp
        .text()
        .await
        .map_err(|e| format!("读取正文失败: {e}"))?;
    Ok(html_to_text(&html))
}

/// 极简 HTML→纯文本（char 索引扫描，UTF-8 安全）：
/// 跳过 script/style 块内容，去掉标签（当空白），解码常见实体，压缩空白，限长。
fn html_to_text(html: &str) -> String {
    let chars: Vec<char> = html.chars().collect();
    let n = chars.len();
    let mut out = String::with_capacity(n);
    let mut i = 0;
    while i < n {
        if chars[i] == '<' {
            let name = tag_name(&chars, i + 1);
            if name == "script" || name == "style" {
                i = skip_to_close(&chars, i, &name);
                continue;
            }
            // 普通标签：跳到 '>'，并以空白替代（便于后续分词）
            while i < n && chars[i] != '>' {
                i += 1;
            }
            if i < n {
                i += 1; // 跳过 '>'
            }
            out.push(' ');
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }

    // 常见 HTML 实体
    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");

    // 压缩空白
    let collapsed = decoded.split_whitespace().collect::<Vec<_>>().join(" ");

    // 限长
    if collapsed.chars().count() > MAX_TEXT_CHARS {
        collapsed.chars().take(MAX_TEXT_CHARS).collect()
    } else {
        collapsed
    }
}

/// 从 '<' 之后的位置读取标签名（小写；跳过前导 '/'）。
fn tag_name(chars: &[char], mut i: usize) -> String {
    if i < chars.len() && chars[i] == '/' {
        i += 1;
    }
    let mut name = String::new();
    while i < chars.len() && chars[i].is_ascii_alphanumeric() {
        name.push(chars[i].to_ascii_lowercase());
        i += 1;
    }
    name
}

/// 从 start（'<' 所在处）跳到 `</name>` 之后的位置；找不到闭合则跳到末尾。
fn skip_to_close(chars: &[char], start: usize, name: &str) -> usize {
    let n = chars.len();
    let mut i = start + 1;
    while i < n {
        if chars[i] == '<' && i + 1 < n && chars[i + 1] == '/' {
            let close = tag_name(chars, i + 1);
            if close == name {
                // 跳到该闭合标签的 '>' 之后
                let mut j = i;
                while j < n && chars[j] != '>' {
                    j += 1;
                }
                return if j < n { j + 1 } else { n };
            }
        }
        i += 1;
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_tags_and_scripts() {
        let html = "<html><head><style>.a{color:red}</style></head><body><p>你好 world</p><script>var x=1;</script></body></html>";
        let text = html_to_text(html);
        assert!(text.contains("你好"));
        assert!(text.contains("world"));
        assert!(!text.contains("color:red")); // style 内容被跳过
        assert!(!text.contains("var x")); // script 内容被跳过
    }

    #[test]
    fn decodes_entities_and_collapses_ws() {
        let html = "<p>a&nbsp;&amp;&nbsp;b\n\n   c</p>";
        let text = html_to_text(html);
        assert_eq!(text, "a & b c");
    }

    #[tokio::test]
    async fn rejects_non_http_scheme() {
        // file:// 与裸路径一律拒绝（防本地文件读取）
        assert!(fetch_url_text("file:///etc/passwd".into()).await.is_err());
        assert!(fetch_url_text("C:/Windows/win.ini".into()).await.is_err());
    }

    #[test]
    fn handles_unclosed_script() {
        // 无闭合 script：其后内容被丢弃，不 panic
        let html = "<p>keep</p><script>runaway";
        let text = html_to_text(html);
        assert!(text.contains("keep"));
        assert!(!text.contains("runaway"));
    }
}
