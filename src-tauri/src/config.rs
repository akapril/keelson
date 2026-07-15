// config.rs — 应用配置（config.toml）读写（Task 16）
//
// MVP 覆盖字段：
//   hotkey       — 全局快捷键，默认 "CommandOrControl+Shift+Space"
//   terminal_pref — 终端偏好，默认 "auto"（terminal 模块自动探测）
//
// 格式：TOML（人类可读，与 retalk 的 config 形态一致）
// 路径：AppPaths.app_data / config.toml

use std::path::Path;
use serde::{Deserialize, Serialize};

/// 应用配置（持久化到 config.toml）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// 全局快捷键，如 "CommandOrControl+Shift+Space"
    #[serde(default = "default_hotkey")]
    pub hotkey: String,

    /// 终端偏好，如 "auto" / "wt" / "pwsh" / "iterm" 等。
    /// "auto" 时由 terminal::detect_terminal 自动探测系统可用终端。
    #[serde(default = "default_terminal_pref")]
    pub terminal_pref: String,
}

fn default_hotkey() -> String {
    "CommandOrControl+Shift+Space".to_string()
}

fn default_terminal_pref() -> String {
    "auto".to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            hotkey: default_hotkey(),
            terminal_pref: default_terminal_pref(),
        }
    }
}

impl AppConfig {
    /// 从指定路径加载 config.toml。
    /// 若文件不存在或解析失败，返回默认配置（非致命）。
    pub fn load(path: &Path) -> Self {
        match std::fs::read_to_string(path) {
            Ok(content) => toml::from_str(&content).unwrap_or_else(|e| {
                eprintln!("[rework] config.toml 解析失败，使用默认配置: {e}");
                Self::default()
            }),
            Err(_) => Self::default(),
        }
    }

    /// 将配置序列化为 TOML 并写入指定路径。
    /// 若父目录不存在，自动创建。
    pub fn save(&self, path: &Path) -> anyhow::Result<()> {
        // 确保父目录存在
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = toml::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// 验证默认配置字段值
    #[test]
    fn default_config_fields() {
        let cfg = AppConfig::default();
        assert_eq!(cfg.hotkey, "CommandOrControl+Shift+Space");
        assert_eq!(cfg.terminal_pref, "auto");
    }

    /// 验证 save + load 往返一致性
    #[test]
    fn save_and_load_roundtrip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");

        let original = AppConfig {
            hotkey: "Alt+Space".to_string(),
            terminal_pref: "wt".to_string(),
        };
        original.save(&path).expect("save 应成功");

        let loaded = AppConfig::load(&path);
        assert_eq!(loaded.hotkey, "Alt+Space");
        assert_eq!(loaded.terminal_pref, "wt");
    }

    /// 文件不存在时返回默认值（非 panic）
    #[test]
    fn load_missing_file_returns_default() {
        let cfg = AppConfig::load(Path::new("/nonexistent/path/config.toml"));
        assert_eq!(cfg.hotkey, default_hotkey());
        assert_eq!(cfg.terminal_pref, default_terminal_pref());
    }

    /// 损坏的 TOML 内容时回退默认值
    #[test]
    fn load_invalid_toml_returns_default() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "not valid toml !!!@@@###").unwrap();
        let cfg = AppConfig::load(&path);
        // 不 panic，字段为默认值
        assert_eq!(cfg.hotkey, default_hotkey());
    }
}
