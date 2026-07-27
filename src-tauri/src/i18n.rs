//! Rust 侧用户可见文案的极简中英映射：仅覆盖托盘菜单与 MCP 通知。
//! key 命名与前端语义一致；未知 key 或未知语言回退英文。

/// 按 locale 取文案。locale 取 "zh" 用中文，其余（含 "en"）用英文。
pub fn t(locale: &str, key: &str) -> &'static str {
    let zh = locale == "zh";
    match key {
        "tray.show" => if zh { "显示 Keelson" } else { "Show Keelson" },
        "tray.quit" => if zh { "退出" } else { "Quit" },
        // MCP 外部动作通知：任务/文档创建前缀（动态标题由调用方 format! 拼接）
        "notify.task.created" => if zh { "MCP 新建任务：" } else { "MCP created task: " },
        "notify.doc.created" => if zh { "MCP 新建文档：" } else { "MCP created doc: " },
        // 应用内通知正文：外部 AI 经 MCP 创建
        "notify.external.body" => if zh { "由外部 AI（claude / codex）经 MCP 创建" } else { "Created by external AI (claude / codex) via MCP" },
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::t;
    #[test]
    fn zh_and_en_and_fallback() {
        assert_eq!(t("zh", "tray.quit"), "退出");
        assert_eq!(t("en", "tray.quit"), "Quit");
        assert_eq!(t("fr", "tray.quit"), "Quit"); // 未知语言回退英文
        assert_eq!(t("zh", "nope"), "");           // 未知 key 空串（调用方自兜底）
        // MCP 通知文案 zh/en 覆盖
        assert_eq!(t("zh", "notify.task.created"), "MCP 新建任务：");
        assert_eq!(t("en", "notify.task.created"), "MCP created task: ");
        assert_eq!(t("zh", "notify.doc.created"), "MCP 新建文档：");
        assert_eq!(t("en", "notify.doc.created"), "MCP created doc: ");
        assert_eq!(t("zh", "notify.external.body"), "由外部 AI（claude / codex）经 MCP 创建");
        assert_eq!(
            t("en", "notify.external.body"),
            "Created by external AI (claude / codex) via MCP"
        );
        assert_eq!(t("fr", "notify.task.created"), "MCP created task: "); // 未知语言回退英文
    }
}
