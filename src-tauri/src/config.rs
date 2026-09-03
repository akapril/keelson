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

    /// 上次退出时 Web Gateway 是否处于开启状态。
    /// true → 下次启动 PB 就绪后自动重启 gateway（「记住上次状态」）。
    /// 由 web_gateway_start/stop 命令写入；默认 false（首次/从未开启则不自动起）。
    #[serde(default)]
    pub web_autostart: bool,

    /// 托盘「退出」时如何处理受管 headless 进程：
    /// `"keep"`=保留后台运行（默认，下次打开继续管理）；`"kill"`=全部结束；`"ask"`=每次询问。
    #[serde(default = "default_on_exit_processes")]
    pub on_exit_processes: String,

    /// PocketBase 请求日志保留天数（写入 PB `logs.maxDays`，PB 自动裁剪旧日志控制 auxiliary.db 增长）。
    /// 默认 7。改动在下次启动 bootstrap 时应用。
    #[serde(default = "default_log_retention_days")]
    pub log_retention_days: u32,

    /// 待清空日志标记：设置里点「清空日志」置 true → 下次启动 PB 前删除 auxiliary.db*（PB 重建空库，
    /// 立即回收磁盘），清完自动复位。为 false 时不动。
    #[serde(default)]
    pub clear_logs_pending: bool,

    /// Web 远程访问的功能开关（敏感能力默认关、按需开）。
    #[serde(default)]
    pub web_features: WebFeatures,
}

/// Web 远程访问按能力分组的功能开关。
/// 安全默认：只读能力（会话浏览 / 日历 git 活动）默认开；用密钥/高风险能力默认关。
/// 网关按位放行对应 `/api/*` 端点，关着一律 403。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebFeatures {
    /// 会话浏览（`/api/sessions_list`）。只读，默认开。
    #[serde(default = "default_true")]
    pub sessions: bool,
    /// 日历「今日活动 / 回顾」的 git 活动读取（`/api/git_log`）。只读，默认开。
    #[serde(default = "default_true")]
    pub activity: bool,
    /// AI 日报 / 对话（`/api/ai_chat`，使用你的密钥）。默认关（占位，路由后续接入）。
    #[serde(default)]
    pub ai: bool,
    /// 看板 tab（`/pb` board_* 集合）。默认开。
    #[serde(default = "default_true")]
    pub board: bool,
    /// 日历 tab（`/pb` calendar_events 集合）。默认开。
    #[serde(default = "default_true")]
    pub calendar: bool,
    /// 文档 tab（`/pb` docs/doc_assets/reading_items 集合）。默认开。
    #[serde(default = "default_true")]
    pub docs: bool,
    /// 终端 tab（`/ws/terminal` 远程 PTY）。最敏感（远程 shell），默认开但可关。
    #[serde(default = "default_true")]
    pub terminal: bool,
}

fn default_true() -> bool {
    true
}

impl Default for WebFeatures {
    fn default() -> Self {
        Self {
            sessions: true,
            activity: true,
            ai: false,
            board: true,
            calendar: true,
            docs: true,
            terminal: true,
        }
    }
}

fn default_on_exit_processes() -> String {
    "keep".to_string()
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
            web_autostart: false,
            on_exit_processes: default_on_exit_processes(),
            log_retention_days: default_log_retention_days(),
            clear_logs_pending: false,
            web_features: WebFeatures::default(),
        }
    }
}

/// PocketBase 日志保留天数默认值。
fn default_log_retention_days() -> u32 {
    7
}

impl AppConfig {
    /// 从指定路径加载 config.toml。
    /// 若文件不存在或解析失败，返回默认配置（非致命）。
    pub fn load(path: &Path) -> Self {
        match std::fs::read_to_string(path) {
            Ok(content) => toml::from_str(&content).unwrap_or_else(|e| {
                eprintln!("[keelson] config.toml 解析失败，使用默认配置: {e}");
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
            web_autostart: true,
            on_exit_processes: "ask".to_string(),
            log_retention_days: default_log_retention_days(),
            clear_logs_pending: false,
        };
        original.save(&path).expect("save 应成功");

        let loaded = AppConfig::load(&path);
        assert_eq!(loaded.hotkey, "Alt+Space");
        assert_eq!(loaded.terminal_pref, "wt");
        assert!(loaded.web_autostart); // 记住上次开启状态，往返保真
        assert_eq!(loaded.on_exit_processes, "ask"); // 退出行为往返保真
    }

    /// 旧 config.toml（缺新字段）应用各自默认（serde default）。
    #[test]
    fn load_legacy_config_defaults_new_fields() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "hotkey = \"Alt+X\"\nterminal_pref = \"wt\"\n").unwrap();
        let cfg = AppConfig::load(&path);
        assert_eq!(cfg.hotkey, "Alt+X");
        assert!(!cfg.web_autostart); // 缺字段 → 默认 false
        assert_eq!(cfg.on_exit_processes, "keep"); // 缺字段 → 默认 keep
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
