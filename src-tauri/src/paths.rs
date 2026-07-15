use std::path::PathBuf;

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

    /// Claude Code 的数据目录：`~/.claude/`
    pub fn claude_dir(&self) -> PathBuf {
        self.home.join(".claude")
    }

    /// Codex（OpenAI Codex CLI）的数据目录：`~/.codex/`
    pub fn codex_dir(&self) -> PathBuf {
        self.home.join(".codex")
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
}
