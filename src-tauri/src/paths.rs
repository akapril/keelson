use std::path::{Path, PathBuf};

/// 解析配置目录：官方环境变量(非空)优先，否则回退 home 下的默认子目录。
/// 纯函数（env 值由调用方传入），避免测试改全局环境影响并行用例。
fn resolve_dir(home: &Path, env_val: Option<&str>, default_sub: &str) -> PathBuf {
    match env_val {
        Some(v) if !v.trim().is_empty() => PathBuf::from(v.trim()),
        _ => home.join(default_sub),
    }
}

/// 应用路径集合：封装所有与用户 home 目录相关的路径派生逻辑，
/// 替代 retalk 中硬编码的 `~/.claude/retalk/` 处理方式。
#[derive(Debug, Clone)]
pub struct AppPaths {
    /// 用户 home 目录
    pub home: PathBuf,
    /// 应用数据目录（由 Tauri 提供的 app_data_dir）
    pub app_data: PathBuf,
}

impl AppPaths {
    /// 自动探测当前用户的 home 目录与 app_data 目录。
    /// 使用 `dirs` crate 获取跨平台的标准路径。
    pub fn detect() -> Self {
        let home = dirs::home_dir().expect("无法获取 home 目录");
        // app_data 回退到 home/.rework，供单元测试或 CLI 工具使用；
        // 生产环境下由 Tauri 的 app_data_dir() 覆盖。
        let app_data = dirs::data_dir()
            .unwrap_or_else(|| home.join(".local/share"))
            .join("rework");
        Self { home, app_data }
    }

    /// Claude Code 的数据目录：官方环境变量 `CLAUDE_CONFIG_DIR`（若设置）优先，否则 `~/.claude/`。
    pub fn claude_dir(&self) -> PathBuf {
        resolve_dir(
            &self.home,
            std::env::var("CLAUDE_CONFIG_DIR").ok().as_deref(),
            ".claude",
        )
    }

    /// Codex（OpenAI Codex CLI）的数据目录：官方环境变量 `CODEX_HOME`（若设置）优先，否则 `~/.codex/`。
    pub fn codex_dir(&self) -> PathBuf {
        resolve_dir(
            &self.home,
            std::env::var("CODEX_HOME").ok().as_deref(),
            ".codex",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证 AppPaths::detect() 能够成功探测 home 目录，且该目录实际存在于磁盘上。
    #[test]
    fn app_paths_detects_home() {
        let paths = AppPaths::detect();
        assert!(
            paths.home.exists(),
            "home 目录应存在于磁盘: {:?}",
            paths.home
        );
    }

    /// resolve_dir：官方环境变量非空时优先，否则回退默认子目录。
    #[test]
    fn resolve_dir_prefers_env_over_default() {
        let home = Path::new("/home/u");
        // 未设置 / 空 / 纯空白 → 回退默认
        assert_eq!(resolve_dir(home, None, ".claude"), home.join(".claude"));
        assert_eq!(resolve_dir(home, Some(""), ".claude"), home.join(".claude"));
        assert_eq!(resolve_dir(home, Some("   "), ".codex"), home.join(".codex"));
        // 设置非空 → 用它（去空白）
        assert_eq!(
            resolve_dir(home, Some("/custom/claude"), ".claude"),
            PathBuf::from("/custom/claude")
        );
        assert_eq!(
            resolve_dir(home, Some("  /x/codex  "), ".codex"),
            PathBuf::from("/x/codex")
        );
    }
}
