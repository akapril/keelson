// providers/mod.rs — 4-责任 SessionProvider trait + ProviderRegistry
// Task 9: 为所有 provider（Claude、Codex 等）定义统一接口，
// 下游的扫描/更新/时间轴/终端任务（Task 10–16）通过本模块路由，
// 无需任何 `match provider` 分支。

pub mod claude;
pub mod codex;

use std::path::{Path, PathBuf};
use crate::models::{Session, TimelineMessage};

/// 截断字符串到指定字符数（超出部分用 "..." 替代）。
/// 各 provider 时间线渲染共用（原 claude.rs/codex.rs 各有一份，已收敛到此）。
pub(crate) fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() > max {
        s.chars().take(max).collect::<String>() + "..."
    } else {
        s.to_string()
    }
}

/// 文件系统监听根节点
pub struct WatchRoot {
    /// 要监听的目录路径
    pub path: PathBuf,
    /// 是否递归监听子目录
    pub recursive: bool,
}

/// 文件事件分类：决定 watcher 收到事件后应触发哪种扫描策略
#[derive(Debug, PartialEq)]
pub enum EventKind {
    /// 忽略此事件（与本 provider 无关）
    Ignore,
    /// 增量扫描：仅重新解析该单一路径
    Incremental,
    /// 全量重扫：provider 的完整 scan_all
    FullRescan,
}

/// SessionProvider：涵盖 provider 的 4 大职责：
/// 1. 全量扫描（scan_all）
/// 2. 增量扫描（classify_event + scan_one）
/// 3. 恢复命令生成（resume_command）
/// 4. 时间轴读取（read_timeline）
pub trait SessionProvider: Send + Sync {
    /// provider 唯一标识符，如 "claude" / "codex"
    fn id(&self) -> &'static str;

    /// 面向用户的显示名称，如 "Claude Code" / "OpenAI Codex"
    fn display_name(&self) -> &'static str;

    /// 检测本 provider 在当前系统上是否可用（CLI 是否存在等）
    fn is_available(&self) -> bool;

    /// 返回本 provider 需要 watcher 监听的根目录列表
    fn watch_roots(&self) -> Vec<WatchRoot>;

    /// 返回需要探测/刷新的路径列表（用于定期轮询）
    fn refresh_probe_paths(&self) -> Vec<PathBuf>;

    /// 全量扫描：返回该 provider 下所有会话
    fn scan_all(&self) -> Vec<Session>;

    /// 将文件系统事件路径分类为 Ignore / Incremental / FullRescan
    fn classify_event(&self, path: &Path) -> EventKind;

    /// 增量扫描：解析单一路径对应的会话，返回 None 表示无需更新
    fn scan_one(&self, path: &Path) -> Option<Session>;

    /// 生成在终端中恢复指定会话的命令字符串
    fn resume_command(&self, project_path: &str, session_id: &str) -> String;

    /// 生成在终端中「新建会话」的命令字符串（不带 session id，就地起一个全新 CLI 会话）。
    /// 默认 = provider id（即 CLI 二进制名，如 claude / codex）；可选带初始提示。
    fn start_command(&self, initial_prompt: Option<&str>) -> String {
        match initial_prompt {
            // 提示词用双引号包裹；内部双引号转义，避免破坏命令
            Some(p) if !p.trim().is_empty() => {
                format!("{} \"{}\"", self.id(), p.replace('"', "\\\""))
            }
            _ => self.id().to_string(),
        }
    }

    /// argv 版恢复命令：直接返回参数向量，**不经 shell 解析**。
    ///
    /// 与字符串版 [`resume_command`](Self::resume_command) 的关键差异：
    /// `session_id` 作为**独立 argv 元素**返回（不拼进命令字符串），
    /// 供 `web/terminal.rs` 用 `CommandBuilder` 逐参数传递、**不经 `sh -c`/`cmd /C`**。
    /// 由此 shell 元字符（`;|$()` 等）永远不会被解释 → 从根上消除命令注入面。
    ///
    /// 默认实现：`[provider_id, "--resume", session_id]`；provider 可覆写子命令形态。
    fn resume_argv(&self, _project_path: &str, session_id: &str) -> Vec<String> {
        vec![
            self.id().to_string(),
            "--resume".to_string(),
            session_id.to_string(),
        ]
    }

    /// argv 版新建命令：直接返回参数向量，**不经 shell 解析**。
    ///
    /// `initial_prompt` 作为**独立 argv 元素**（不拼字符串、不加引号），
    /// 因此 prompt 里的空格/引号/元字符都原样透传给 CLI，不被 shell 解释。
    ///
    /// 默认实现：`[provider_id]`，有非空 prompt 时追加 `[provider_id, prompt]`。
    fn start_argv(&self, initial_prompt: Option<&str>) -> Vec<String> {
        match initial_prompt {
            Some(p) if !p.trim().is_empty() => vec![self.id().to_string(), p.to_string()],
            _ => vec![self.id().to_string()],
        }
    }

    /// 读取指定会话的时间轴消息列表（用于详情页展示）
    fn read_timeline(&self, session_id: &str) -> Vec<TimelineMessage>;
}

/// ProviderRegistry：统一注册并路由所有已安装的 provider，
/// 消除下游代码中的 `match provider` 分支。
pub struct ProviderRegistry {
    providers: Vec<Box<dyn SessionProvider>>,
}

impl ProviderRegistry {
    /// 创建注册表：注册 Claude provider（Task 10）+ Codex provider（Task 11）
    pub fn new() -> Self {
        Self {
            providers: vec![
                Box::new(claude::ClaudeProvider),
                Box::new(codex::CodexProvider),
            ],
        }
    }

    /// 返回当前已安装（is_available）的所有 provider 迭代器
    pub fn installed(&self) -> impl Iterator<Item = &dyn SessionProvider> {
        self.providers.iter().map(|b| b.as_ref()).filter(|p| p.is_available())
    }

    /// 按 id 查找 provider（不限 is_available）
    pub fn by_id(&self, id: &str) -> Option<&dyn SessionProvider> {
        self.providers.iter().map(|b| b.as_ref()).find(|p| p.id() == id)
    }

    /// watcher/scanner 用：某路径归哪个 provider + 该走增量还是全量。
    /// 遍历所有 provider，返回第一个不忽略该路径的 provider 及其事件分类。
    pub fn route_path(&self, path: &Path) -> Option<(&dyn SessionProvider, EventKind)> {
        for p in self.providers.iter().map(|b| b.as_ref()) {
            let k = p.classify_event(path);
            if k != EventKind::Ignore {
                return Some((p, k));
            }
        }
        None
    }

    /// 汇总所有已安装 provider 的监听根目录
    pub fn all_watch_roots(&self) -> Vec<WatchRoot> {
        self.installed().flat_map(|p| p.watch_roots()).collect()
    }

    /// 汇总所有已安装 provider 的全量扫描结果
    pub fn scan_all(&self) -> Vec<Session> {
        self.installed().flat_map(|p| p.scan_all()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fake provider：用于单元测试，识别路径中含 ".fake" 的为增量事件
    struct Fake;

    impl SessionProvider for Fake {
        fn id(&self) -> &'static str { "fake" }
        fn display_name(&self) -> &'static str { "Fake" }
        fn is_available(&self) -> bool { true }
        fn watch_roots(&self) -> Vec<WatchRoot> { vec![] }
        fn refresh_probe_paths(&self) -> Vec<PathBuf> { vec![] }
        fn scan_all(&self) -> Vec<Session> { vec![] }
        fn classify_event(&self, p: &Path) -> EventKind {
            if p.to_string_lossy().contains(".fake") {
                EventKind::Incremental
            } else {
                EventKind::Ignore
            }
        }
        fn scan_one(&self, _: &Path) -> Option<Session> { None }
        fn resume_command(&self, _: &str, _: &str) -> String { String::new() }
        fn read_timeline(&self, _: &str) -> Vec<TimelineMessage> { vec![] }
    }

    /// 验证 route_path 能按 classify_event 正确路由，
    /// 未匹配路径返回 None
    #[test]
    fn routes_by_classify_event() {
        let reg = ProviderRegistry { providers: vec![Box::new(Fake)] };
        let (p, k) = reg.route_path(Path::new("/x/.fake/a.jsonl")).unwrap();
        assert_eq!(p.id(), "fake");
        assert_eq!(k, EventKind::Incremental);
        assert!(reg.route_path(Path::new("/x/other/a.jsonl")).is_none());
    }
}
