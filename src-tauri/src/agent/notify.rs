//! agent 决策通知：文案组装（纯函数，可测）+ 写 notification（异步 helper）。
use crate::pb::client::PbClient;
use serde_json::json;

/// notification source 值（不含 `.`——i18next 路径分隔限制）。
pub const AGENT_NOTIF_SOURCE: &str = "Agent";
/// 点击通知的深链目标（/inbox 的 Agent 待办标签）。
pub const AGENT_NOTIF_LINK: &str = "/inbox?tab=agent";

/// 组装 agent 决策通知文案：返回 (title, body, kind)。
/// - review → kind=info（待审，等人合并）
/// - 其它（blocked/超时）→ kind=warning（受阻，需人处理）
pub fn build_agent_notification(
    status: &str,
    agent_name: &str,
    task_title: &str,
    blocker: &str,
) -> (String, String, &'static str) {
    if status == "review" {
        (
            format!("队友 {agent_name} 完成待审"),
            format!("任务「{task_title}」已完成，等待你审阅合并"),
            "info",
        )
    } else {
        (
            format!("队友 {agent_name} 受阻"),
            format!("任务「{task_title}」受阻：{blocker}"),
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
}
