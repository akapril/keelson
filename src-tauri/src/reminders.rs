//! 日历「日程提醒」后台 worker。
//!
//! 轮询 `calendar_events` 中到点（`remind_at <= now`）且未提醒（`reminded != true`）的事件，
//! 逐条：① 推**系统通知**（OS 级，窗口隐藏到托盘也能看到）② 写一条应用内 `notifications`（收件箱）
//! ③ 标记 `reminded=true` 去重。
//!
//! remind_at 由前端 `computeRemindAt` 写成秒级 UTC ISO（`YYYY-MM-DDTHH:MM:SSZ`），本 worker 的
//! `now_iso()` 用**同一格式**，故 PB 文本字段的 `<=` 字典序比较即时间序比较，无需 PB datetime 类型。
//!
//! 生命周期：应用 setup 时 spawn，随进程常驻；auth 未就绪的轮次跳过（bootstrap 完成后自然生效）。
//! 「关着也提醒」= 窗口隐藏/最小化但进程在跑（托盘常驻）；进程被彻底杀死期间不触发，
//! 下次启动会补推逾期未提醒的（remind_at<=now 仍成立）。
use crate::pb::client::PbClient;
use crate::AppState;
use serde_json::json;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// 轮询间隔（秒）。到点提醒最多延迟这么久，30s 足够精细又不费。
const POLL_SECS: u64 = 30;
/// 通知来源标识（不含 `.`——i18next 路径分隔限制）。前端 notification-prefs 已登记同名可开关。
pub const REMINDER_SOURCE: &str = "日程提醒";
/// 点击通知的深链目标。
const REMINDER_LINK: &str = "/calendar";

/// 组装提醒通知文案：返回 (title, body)。纯函数，可测。
pub fn build_reminder_text(title: &str) -> (String, String) {
    let t = if title.trim().is_empty() { "（无标题）" } else { title };
    (format!("日程提醒：{t}"), format!("到点了：{t}"))
}

/// PB filter 值转义：剔除双引号，避免破坏 filter 串（owner 来自受信 auth，此为纵深防御）。
fn esc(s: &str) -> String {
    s.replace('"', "")
}

/// 构建「到点未提醒」事件的 PB filter。纯函数，可测。
/// 条件：属当前用户、remind_at 非空且 <= now、未提醒、未软删。
pub fn build_due_filter(owner: &str, now: &str) -> String {
    format!(
        "owner = \"{}\" && remind_at != \"\" && remind_at <= \"{}\" && reminded != true && deleted_at = \"\"",
        esc(owner),
        esc(now),
    )
}

/// 当前 UTC 时间秒级 ISO（`YYYY-MM-DDTHH:MM:SSZ`），与前端 computeRemindAt 同格式。
fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// 跑一轮：查到点未提醒事件，逐条推送 + 标记去重。任何单条失败不阻断其余（尽力而为）。
async fn tick(app: &AppHandle, client: &PbClient, owner: &str) {
    let filter = build_due_filter(owner, &now_iso());
    let items = match client.list("calendar_events", &filter, "id,title,remind_at").await {
        Ok(v) => v,
        Err(_) => return, // PB 暂时不可用：跳过本轮，下轮再试
    };
    for it in items {
        let id = it.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if id.is_empty() {
            continue;
        }
        let title = it.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let (ntitle, nbody) = build_reminder_text(title);
        // ① 系统通知（OS 级；窗口隐藏也可见）
        let _ = app.notification().builder().title(ntitle.clone()).body(nbody.clone()).show();
        // ② 应用内通知（收件箱）
        let _ = client
            .create(
                "notifications",
                &json!({
                    "owner":  owner,
                    "title":  ntitle,
                    "body":   nbody,
                    "kind":   "info",
                    "source": REMINDER_SOURCE,
                    "link":   REMINDER_LINK,
                    "read":   false,
                }),
            )
            .await;
        // ③ 标记已提醒（去重，避免下轮重复推）
        let _ = client
            .patch("calendar_events", id, &json!({ "reminded": true }))
            .await;
    }
}

/// 启动后台提醒 worker：每 POLL_SECS 轮询一次。auth 未就绪的轮次跳过。
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(POLL_SECS));
        loop {
            ticker.tick().await;
            // 取 auth（base_url/token/user_id）；未就绪则等下一轮。
            // 仅在同步块内持锁并 clone，锁在 await 前释放（不跨 await 持 parking_lot guard）。
            let creds = {
                let st = app.state::<AppState>();
                let g = st.auth.lock();
                g.as_ref().map(|a| (a.base_url.clone(), a.token.clone(), a.user_id.clone()))
            };
            let Some((base, token, user)) = creds else {
                continue;
            };
            let client = PbClient::new(&base, &token);
            tick(&app, &client, &user).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reminder_text_mentions_title() {
        let (title, body) = build_reminder_text("健身");
        assert!(title.contains("健身"));
        assert!(body.contains("健身"));
    }

    #[test]
    fn reminder_text_handles_empty_title() {
        let (_t, body) = build_reminder_text("   ");
        assert!(body.contains("（无标题）"));
    }

    #[test]
    fn due_filter_has_all_clauses() {
        let f = build_due_filter("u1", "2026-09-03T14:30:00Z");
        assert!(f.contains("owner = \"u1\""));
        assert!(f.contains("remind_at != \"\""));
        assert!(f.contains("remind_at <= \"2026-09-03T14:30:00Z\""));
        assert!(f.contains("reminded != true"));
        assert!(f.contains("deleted_at = \"\""));
    }

    #[test]
    fn due_filter_escapes_quotes() {
        // owner 含双引号被剔除，不破坏 filter 串
        let f = build_due_filter("a\"b", "2026-01-01T00:00:00Z");
        assert!(f.contains("owner = \"ab\""));
        assert!(!f.contains("a\"b"));
    }
}
