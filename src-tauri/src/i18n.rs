//! Rust 侧用户可见文案的极简中英映射：仅覆盖托盘菜单与 MCP 通知。
//! key 命名与前端语义一致；未知 key 或未知语言回退英文。

/// 按 locale 取文案。locale 取 "zh" 用中文，其余（含 "en"）用英文。
pub fn t(locale: &str, key: &str) -> &'static str {
    let zh = locale == "zh";
    match key {
        "tray.show" => if zh { "显示 Keelson" } else { "Show Keelson" },
        "tray.quit" => if zh { "退出" } else { "Quit" },
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
    }
}
