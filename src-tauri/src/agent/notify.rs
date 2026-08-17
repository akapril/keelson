//! agent 决策通知：文案组装（纯函数，可测）+ 写 notification（异步 helper）。
use crate::pb::client::PbClient;
use serde_json::json;

/// notification source 值（不含 `.`——i18next 路径分隔限制）。
pub const AGENT_NOTIF_SOURCE: &str = "Agent";
/// 点击通知的深链目标（/inbox 的 Agent 待办标签）。
pub const AGENT_NOTIF_LINK: &str = "/inbox?tab=agent";

/// notifications.body 字段 PB 上限（chars），留 200 余量给前缀文案。
const BLOCKER_MAX_CHARS: usize = 500;
/// task_title 防御性截断上限（chars）。
const TITLE_MAX_CHARS: usize = 200;

/// 截断字符串到指定字符数上限，超出时追加省略号。
/// 按字符边界截断，不破坏 Unicode 多字节字符。
fn truncate_chars(s: &str, max: usize) -> String {
    let mut chars = s.chars();
    let truncated: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        // 原串比 max 长，追加省略号
        format!("{truncated}…")
    } else {
        truncated
    }
}

/// 组装 agent 决策通知文案：返回 (title, body, kind)。
/// - review → kind=info（待审，等人合并）
/// - 其它（blocked/超时）→ kind=warning（受阻，需人处理）
/// blocker 截断至 BLOCKER_MAX_CHARS，task_title 截断至 TITLE_MAX_CHARS，
/// 防止 PB body 字段超限（上限 2000）导致通知写入被拒。
pub fn build_agent_notification(
    status: &str,
    agent_name: &str,
    task_title: &str,
    blocker: &str,
) -> (String, String, &'static str) {
    // 防御性截断：通知 body 为展示用途，全文存于 run.blocker，不影响溯源
    let safe_title = truncate_chars(task_title, TITLE_MAX_CHARS);
    if status == "review" {
        (
            format!("队友 {agent_name} 完成待审"),
            format!("任务「{safe_title}」已完成，等待你审阅合并"),
            "info",
        )
    } else {
        let safe_blocker = truncate_chars(blocker, BLOCKER_MAX_CHARS);
        (
            format!("队友 {agent_name} 受阻"),
            format!("任务「{safe_title}」受阻：{safe_blocker}"),
            "warning",
        )
    }
}

/// 写一条 agent 决策通知（失败非致命，不阻断 run 落库）。
pub async fn notify_decision(
    client: &PbClient,
    owner_id: &str,
    status: &str,
    agent_name: &str,
    task_title: &str,
    blocker: &str,
) {
    let (title, body, kind) = build_agent_notification(status, agent_name, task_title, blocker);
    let _ = client
        .create("notifications", &json!({
            "owner":  owner_id,
            "title":  title,
            "body":   body,
            "kind":   kind,
            "source": AGENT_NOTIF_SOURCE,
            "link":   AGENT_NOTIF_LINK,
            "read":   false,
        }))
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_is_info_and_mentions_task() {
        let (title, body, kind) = build_agent_notification("review", "小K", "修登录", "");
        assert_eq!(kind, "info");
        assert!(title.contains("小K"));
        assert!(body.contains("修登录"));
    }

    #[test]
    fn blocked_is_warning_and_mentions_blocker() {
        let (_t, body, kind) = build_agent_notification("blocked", "小C", "改样式", "超时已终止");
        assert_eq!(kind, "warning");
        assert!(body.contains("改样式"));
        assert!(body.contains("超时已终止"));
    }

    #[test]
    fn long_blocker_is_truncated_in_body() {
        // 超 BLOCKER_MAX_CHARS 的 blocker 应被截断，body 不超安全长度
        let long_blocker = "x".repeat(BLOCKER_MAX_CHARS + 100);
        let (_t, body, _k) = build_agent_notification("blocked", "小A", "任务标题", &long_blocker);
        // 截断后 body 长度应显著小于原始 blocker 长度
        assert!(body.chars().count() < long_blocker.chars().count());
        // body 应包含省略号（表明发生了截断）
        assert!(body.contains('…'));
    }

    #[test]
    fn short_blocker_is_not_truncated() {
        let blocker = "short error";
        let (_t, body, _k) = build_agent_notification("blocked", "小B", "任务", blocker);
        // 短 blocker 不应被截断，不含省略号（来自截断逻辑）
        assert!(body.contains(blocker));
        // 不含截断省略号
        assert!(!body.contains('…'));
    }
}
