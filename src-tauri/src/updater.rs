// updater.rs — 注册表驱动的文件系统 Watcher（无 `match provider` 分支）
// Task 12：监听目录来自 registry.all_watch_roots()，事件分类通过 registry.route_path()，
// 消除 retalk updater.rs 中硬编码各工具目录和扩展名判断的模式。
//
// 三策略架构（与 retalk 对齐，MVP 以 notify Watcher 为主体）：
//   策略 1：Watcher（notify 文件系统事件，本模块核心）
//   策略 2：Poll（定时轮询，MVP 占位实现，YAGNI 原则保持最小）
//   策略 3：OnDemand（按需刷新，MVP 占位实现，YAGNI 原则保持最小）

use crate::models::Session;
use crate::providers::{EventKind, ProviderRegistry};
use crate::scanner;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher as NotifyWatcher};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

// ============================================================
// 公开 Callback 类型别名（Task 15 同步、Task 16 命令缓存使用）
// ============================================================

/// 会话变化回调类型：
/// - `sessions`：本次事件触发后扫描到的变化会话列表（增量或全量）
/// - `full_rescan`：true 表示本次为全量重扫（下游应替换缓存），
///                  false 表示增量（下游应 upsert 到缓存）
///
/// Task 15（sync）和 Task 16（commands cache）实现方通过此 callback 消费变化。
pub type SessionChangedCallback = Arc<dyn Fn(Vec<Session>, bool) + Send + Sync>;

// ============================================================
// 策略 1：Watcher（notify 驱动，注册表路由）
// ============================================================

/// 文件系统 Watcher：持有 notify watcher 句柄，监听所有已安装 provider 的根目录。
/// 事件触发时通过注册表路由分类，决定增量扫描或全量重扫。
pub struct Watcher {
    /// 持有 notify watcher handle，drop 时自动停止监听
    _handle: RecommendedWatcher,
}

impl Watcher {
    /// 启动 Watcher：
    /// 1. 从注册表获取所有 provider 的监听根目录（无硬编码路径）
    /// 2. 注册 notify 事件处理器，通过 route_path 分类事件
    /// 3. 根据分类结果触发 scan_single（Incremental）或 scan_all（FullRescan）
    /// 4. 将变化的会话列表通过 callback 传给下游（Task 15/16）
    ///
    /// # Arguments
    /// - `reg`：注册表引用（Arc 包装，供回调闭包持有）
    /// - `callback`：会话变化通知函数（`SessionChangedCallback`）
    ///
    /// # Returns
    /// - `Ok(Watcher)`：监听已启动，持有 handle 直到 drop
    /// - `Err`：notify 初始化失败或无可监听目录
    pub fn start(
        reg: Arc<ProviderRegistry>,
        callback: SessionChangedCallback,
    ) -> anyhow::Result<Self> {
        // 获取所有已安装 provider 的监听根目录（替代 retalk 中的硬编码目录列表）
        let watch_roots: Vec<(PathBuf, RecursiveMode)> = reg
            .all_watch_roots()
            .into_iter()
            .map(|root| {
                let mode = if root.recursive {
                    RecursiveMode::Recursive
                } else {
                    RecursiveMode::NonRecursive
                };
                (root.path, mode)
            })
            .collect();

        // 克隆注册表和回调，供事件处理器闭包持有
        let reg_for_event = Arc::clone(&reg);
        let cb = Arc::clone(&callback);

        // 初始化 notify watcher：使用默认推荐后端（inotify / FSEvents / ReadDirectoryChanges）
        let mut handle = RecommendedWatcher::new(
            move |result: notify::Result<notify::Event>| {
                match result {
                    Ok(event) => {
                        // 对每个变化路径通过注册表路由分类
                        let mut needs_full_rescan = false;
                        let mut incremental_sessions: Vec<Session> = Vec::new();

                        for path in &event.paths {
                            match reg_for_event.route_path(path) {
                                Some((_, EventKind::FullRescan)) => {
                                    // 存在任一 FullRescan 事件，标记全量重扫（合并处理效率更高）
                                    needs_full_rescan = true;
                                }
                                Some((provider, EventKind::Incremental)) => {
                                    // 增量扫描：调用 provider.scan_one
                                    if let Some(session) = provider.scan_one(path) {
                                        incremental_sessions.push(session);
                                    }
                                }
                                // Ignore 或无路由：跳过
                                Some((_, EventKind::Ignore)) | None => {}
                            }
                        }

                        // 优先处理全量重扫（FullRescan 覆盖增量，避免重复工作）
                        if needs_full_rescan {
                            let sessions = scanner::scan_all(&reg_for_event);
                            cb(sessions, true);
                        } else if !incremental_sessions.is_empty() {
                            cb(incremental_sessions, false);
                        }
                    }
                    Err(e) => {
                        // 仅记录错误，不中断 watcher（与 retalk 行为一致）
                        eprintln!("[updater] 文件监听错误: {:?}", e);
                    }
                }
            },
            Config::default().with_poll_interval(Duration::from_millis(500)),
        )?;

        // 注册所有监听根目录（仅监听存在的目录，与 retalk 防御性写法一致）
        let mut watched_count = 0usize;
        for (path, mode) in &watch_roots {
            if path.exists() {
                if let Err(e) = handle.watch(path, *mode) {
                    eprintln!("[updater] 注册监听路径失败 {:?}: {:?}", path, e);
                } else {
                    eprintln!("[updater] 已监听: {:?} (recursive={})", path, mode == &RecursiveMode::Recursive);
                    watched_count += 1;
                }
            } else {
                eprintln!("[updater] 跳过不存在的路径: {:?}", path);
            }
        }

        eprintln!("[updater] Watcher 已启动，监听 {} 个根目录", watched_count);

        Ok(Self { _handle: handle })
    }
}

// ============================================================
// 策略 2：Poll（定时轮询，MVP 占位）
// ============================================================

/// 定时轮询策略：检测 provider refresh_probe_paths 的 mtime 变化后触发全量重扫。
/// MVP 阶段提供占位实现（YAGNI），Task 15 可按需完善。
pub struct PollUpdater;

impl PollUpdater {
    /// 启动定时轮询（MVP 占位，当前为无操作）
    pub fn start(
        _reg: Arc<ProviderRegistry>,
        _callback: SessionChangedCallback,
        _interval: Duration,
    ) {
        // TODO(Task 15)：实现定时轮询策略
        // 参考 retalk::updater::Updater::start_poll
    }
}

// ============================================================
// 策略 3：OnDemand（按需刷新，MVP 占位）
// ============================================================

/// 按需刷新策略：弹窗/面板打开时调用，检测 mtime 变化后同步重建。
/// MVP 阶段提供占位实现（YAGNI），Task 15/16 可按需完善。
pub struct OnDemandUpdater;

impl OnDemandUpdater {
    /// 执行按需刷新检查（MVP 占位，当前直接返回 false）
    pub fn refresh(
        _reg: &ProviderRegistry,
        _callback: &SessionChangedCallback,
    ) -> bool {
        // TODO(Task 15)：实现按需刷新策略
        // 参考 retalk::updater::Updater::on_demand_refresh
        false
    }
}

// ============================================================
// 单元测试
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证 SessionChangedCallback 类型签名符合 Task 15/16 的消费接口
    #[test]
    fn callback_type_compiles() {
        // 确认 Arc<dyn Fn(Vec<Session>, bool) + Send + Sync> 可被构造和调用
        let cb: SessionChangedCallback = Arc::new(|sessions: Vec<Session>, full: bool| {
            let _ = (sessions, full);
        });
        // 调用以验证类型正确
        cb(vec![], false);
    }

    /// 验证 Watcher::start 在无已安装 provider 时不 panic（CI 环境兼容性）
    /// 无监听目录时应优雅返回 Ok（watched_count=0），而非 Err
    #[test]
    fn watcher_start_without_providers_does_not_panic() {
        let reg = Arc::new(ProviderRegistry::new());
        let cb: SessionChangedCallback = Arc::new(|_, _| {});
        // 在 CI 环境（无 ~/.claude/projects），all_watch_roots() 返回 Claude 目录（可能不存在）
        // Watcher::start 应成功初始化（只是不监听任何目录）
        let result = Watcher::start(reg, cb);
        assert!(
            result.is_ok(),
            "Watcher::start 应成功初始化，即使无可监听目录: {:?}",
            result.err()
        );
    }

    /// 验证 PollUpdater 和 OnDemandUpdater 占位实现不 panic
    #[test]
    fn stub_updaters_do_not_panic() {
        let reg = Arc::new(ProviderRegistry::new());
        let cb: SessionChangedCallback = Arc::new(|_, _| {});

        PollUpdater::start(Arc::clone(&reg), Arc::clone(&cb), Duration::from_secs(60));
        let refreshed = OnDemandUpdater::refresh(&reg, &cb);
        assert!(!refreshed, "占位实现应返回 false");
    }
}
