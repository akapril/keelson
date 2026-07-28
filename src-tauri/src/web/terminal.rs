//! Web 远程终端：内嵌伪终端（PTY）会话表。
//!
//! 与 `commands/terminal.rs`（用系统终端窗口起 CLI）不同，本模块**不开外部窗口**：
//! 在本进程内用 portable-pty 拉起一个伪终端，把 provider 的 CLI agent（claude/codex）
//! spawn 进 PTY 的 slave 端，master 端持有其 stdin(writer)/stdout+stderr(reader)。
//! 这样 Task 11 的 WebSocket handler 就能双向泵：浏览器键入 → `write`；PTY 输出 → reader。
//!
//! ## provider 命令复用（argv 直传，不经 shell）
//! provider registry 提供两套命令生成：字符串版（`resume_command`/`start_command`，
//! 供**桌面** `commands/terminal.rs` 起系统终端窗口用）与 **argv 版**
//! （`resume_argv`/`start_argv`，本模块专用）。
//!
//! 本模块**不再经系统 shell**（`sh -c` / `cmd /C`），而是取 argv 向量后用
//! `CommandBuilder::new(argv[0])` + `.arg(argv[1..])` 逐参数直传，`cwd=project_path`。
//! session_id / prompt 作为**独立 argv 元素**传递，shell 元字符（`;|$()` 等）永远
//! 不会被解析 → 从根上消除命令注入（Task 11 从 web 传入的 session_id 不再是攻击面）。
//!
//! ## session_id 白名单双保险
//! 除 argv 化外，`open()` 在使用 session_id 前用 [`is_valid_session_id`] 校验
//! `^[A-Za-z0-9_-]+$`（长度 ≤128）。claude UUID、codex session id 均满足；
//! 不匹配直接 `Err`，绝不落到 spawn。
//!
//! ## 并发与回收
//! 会话表用 parking_lot `Mutex`（项目惯例，`.lock()` 无 `unwrap`）。`PtyRegistry` 挂在
//! `AppState` 上以 `Arc` 共享，供 gateway WS handler 访问。`kill` 在终止后 `wait` 收尸；
//! `Drop for PtyRegistry` 在 registry 释放（app 退出）时清场所有残留子进程，杜绝孤儿 agent。

use std::collections::HashMap;
use std::io::{Read, Write};

use parking_lot::Mutex;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};

use crate::providers::ProviderRegistry;

/// 单个 PTY 会话：持有 master 端句柄、可写入的 stdin、以及子进程句柄。
///
/// - `master`：PTY master 端，用于 `resize`（通知子进程窗口大小变化）与 `try_clone_reader`
///   （克隆出只读句柄给 Task 11 读输出）。
/// - `writer`：向 slave 写数据的句柄（= 子进程的 stdin）。`take_writer` 只能取一次，故在
///   `open` 时取出并长期持有。
/// - `child`：子进程句柄。`kill` 需 `&mut self`，`try_wait` 亦然，故整表以 `&mut` 方式访问会话。
struct PtySession {
    /// 子进程 stdin 写端。丢弃它会给 slave 发 EOF，故与会话同生命周期。
    writer: Box<dyn Write + Send>,
    /// PTY master 端：resize / 克隆 reader 都走它。
    master: Box<dyn MasterPty + Send>,
    /// 子进程句柄：kill / 回收。`Send + Sync` 以便跨线程（WS handler）持有。
    child: Box<dyn Child + Send + Sync>,
}

/// PTY 会话注册表：`session_id -> PtySession`。
///
/// 挂在 `AppState`（`Arc<PtyRegistry>`）上，gateway WS handler 与 Tauri 命令共享同一实例。
pub struct PtyRegistry {
    /// 会话表。parking_lot Mutex，`.lock()` 直接返回守卫（非 Result）。
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl Default for PtyRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl PtyRegistry {
    /// 创建空注册表。
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// 打开一个新 PTY 会话并把 provider 的 CLI agent spawn 进去。
    ///
    /// # 参数
    /// - `id`：会话唯一标识（同一 id 已存在会被拒绝，避免覆盖泄漏旧子进程）。
    /// - `provider`：provider 标识（"claude" / "codex"），经 `reg.by_id` 路由。
    /// - `project_path`：项目绝对路径，作为 PTY 的 `cwd`（CLI agent 就地起，会话写盘到此）。
    /// - `session_id`：可选。`Some` → 用 `resume_command` 恢复既有会话；`None` → `start_command` 新建。
    /// - `reg`：provider 注册表（从 `AppState.reg` 传入引用，复用现有命令生成，不新造）。
    ///
    /// # 流程
    /// 1. 校验 session_id 白名单（若有），经 registry 取 provider 的 **argv 版**命令。
    /// 2. `native_pty_system().openpty(PtySize{rows,cols})` 得到 master/slave 对。
    /// 3. `CommandBuilder::new(argv[0])` + `.arg(argv[1..])`、`cwd=project_path`（**不经 shell**）。
    /// 4. spawn 到 slave，取 writer（仅一次）、存 master/writer/child 到会话表。
    pub fn open(
        &self,
        id: &str,
        provider: &str,
        project_path: &str,
        session_id: Option<&str>,
        reg: &ProviderRegistry,
    ) -> Result<(), String> {
        // 拒绝重复 id：否则旧 child 被顶掉后无人 kill，泄漏子进程。
        if self.sessions.lock().contains_key(id) {
            return Err(format!("PTY 会话已存在: {id}"));
        }

        // 1. 经 registry 路由 provider。
        let p = reg
            .by_id(provider)
            .ok_or_else(|| format!("未知 provider: {provider}"))?;

        // 2. 生成 argv（**不经 shell**）。session_id 先过白名单双保险，再作独立 argv 元素传入。
        let argv = match session_id {
            Some(sid) => {
                // 白名单：即便已 argv 化根除了 shell 注入，仍拒绝异常 session_id（纵深防御）。
                if !is_valid_session_id(sid) {
                    return Err(format!("非法 session_id（仅允许 A-Za-z0-9_- 且 ≤128 字符）: {sid}"));
                }
                p.resume_argv(project_path, sid)
            }
            None => p.start_argv(None),
        };
        // argv 至少要有可执行名，否则 CommandBuilder 无从起进程。
        if argv.is_empty() {
            return Err("provider 返回空 argv".to_string());
        }

        // 3. 开 PTY。默认 80x24；前端连上后会立即 resize 到真实终端尺寸。
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty 失败: {e}"))?;

        // 4. 组装 CommandBuilder：argv[0]=CLI 二进制（claude/codex），其余为独立参数；cwd=项目目录。
        //    直传 argv、不经 shell：session_id/prompt 中的元字符不会被解释 → 无注入。
        let mut builder = CommandBuilder::new(&argv[0]);
        for a in &argv[1..] {
            builder.arg(a);
        }
        builder.cwd(project_path);

        // 5. spawn 到 slave 端。spawn 后 slave 句柄即可丢弃（PtyPair 里 slave 先于 master 析构）。
        let child = pair
            .slave
            .spawn_command(builder)
            .map_err(|e| format!("spawn 子进程失败: {e}"))?;

        // 6. 取 writer（只能取一次），随后 slave 出作用域被 drop（无碍，master 仍持 PTY）。
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("获取 PTY writer 失败: {e}"))?;

        let session = PtySession {
            writer,
            master: pair.master,
            child,
        };
        self.sessions.lock().insert(id.to_string(), session);
        Ok(())
    }

    /// 向指定会话的子进程 stdin 写入字节（浏览器键入 → CLI agent）。
    pub fn write(&self, id: &str, bytes: &[u8]) -> Result<(), String> {
        let mut guard = self.sessions.lock();
        let s = guard
            .get_mut(id)
            .ok_or_else(|| format!("PTY 会话不存在: {id}"))?;
        s.writer
            .write_all(bytes)
            .map_err(|e| format!("写 PTY 失败: {e}"))?;
        // 交互式 CLI 依赖及时刷新：不 flush 可能让输入卡在缓冲区。
        s.writer.flush().map_err(|e| format!("flush PTY 失败: {e}"))
    }

    /// 调整 PTY 窗口大小（前端终端 resize 时同步，触发子进程 SIGWINCH/重排）。
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let guard = self.sessions.lock();
        let s = guard
            .get(id)
            .ok_or_else(|| format!("PTY 会话不存在: {id}"))?;
        s.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize PTY 失败: {e}"))
    }

    /// 克隆一个只读句柄，供 Task 11 的 WS handler 在独立线程持续读 PTY 输出。
    ///
    /// 用 `try_clone_reader`（非移动 master），故可多次调用/master 仍留在会话表继续 resize。
    pub fn take_reader(&self, id: &str) -> Result<Box<dyn Read + Send>, String> {
        let guard = self.sessions.lock();
        let s = guard
            .get(id)
            .ok_or_else(|| format!("PTY 会话不存在: {id}"))?;
        s.master
            .try_clone_reader()
            .map_err(|e| format!("克隆 PTY reader 失败: {e}"))
    }

    /// 终止会话：kill 子进程、`wait` 收尸并从表中移除（连同 master/writer 一并 drop，释放 PTY）。
    ///
    /// 摘出会话后在锁外 kill：`kill` 发终止信号；随后 `wait` 回收退出状态，避免留下僵尸进程
    /// / 泄漏进程句柄（不 wait 的话 kill 只发信号，OS 仍保留进程表项直到父进程 reap）。
    pub fn kill(&self, id: &str) -> Result<(), String> {
        // 先从表中摘出会话（仅 remove 在持锁期间完成）。
        let mut session = {
            let mut guard = self.sessions.lock();
            guard
                .remove(id)
                .ok_or_else(|| format!("PTY 会话不存在: {id}"))?
        };
        // kill 需 &mut self；子进程可能已自然退出，此时 kill 报错可忽略（视为已终止）。
        let res = session.child.kill().map_err(|e| format!("kill 子进程失败: {e}"));
        // 收尸：wait 回收退出状态，杜绝僵尸/句柄泄漏（无论 kill 成败都要 reap）。
        let _ = session.child.wait();
        // session 在此出作用域析构：master/writer 关闭，PTY 资源回收。
        res
    }
}

/// registry 释放（app 退出）时清场：遍历所有残留会话，逐个 kill + wait 收尸，
/// 杜绝孤儿 CLI agent 进程。gateway stop / app exit 的**主动**清场钩子由 Task 11/lib.rs 接线，
/// 本 Drop 是兜底：任何路径下只要 registry 被 drop，子进程都不会被遗留。
impl Drop for PtyRegistry {
    fn drop(&mut self) {
        // Drop 独占 &mut self，无并发；直接取出会话表逐个终止。
        let mut guard = self.sessions.lock();
        for (_id, mut session) in guard.drain() {
            let _ = session.child.kill(); // 已退出的报错可忽略
            let _ = session.child.wait(); // 收尸，避免僵尸
        }
    }
}

/// 校验 session_id 是否安全：仅允许 `A-Za-z0-9_-`，长度 1..=128。
///
/// 纵深防御第二层（第一层是 argv 化本身已不经 shell）：拒绝任何含空格/元字符/超长的
/// session_id。claude UUID（如 `3b2d24c0-...`）、codex session id 均满足此约束。
/// 纯函数，无 IO，可 standalone `rustc --test` 验证。
pub fn is_valid_session_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 合法 session_id（claude UUID 风格、codex id）应通过白名单。
    #[test]
    fn valid_session_id_accepts_normal_ids() {
        assert!(is_valid_session_id("3b2d24c0-parent-4a5f-9e3a-64f10dbb2ca4"));
        assert!(is_valid_session_id("codex-session-abc123"));
        assert!(is_valid_session_id("abc_123-XYZ"));
        assert!(is_valid_session_id("a")); // 单字符合法
    }

    /// 含 shell 元字符 / 空格 / 空串 / 超长的 session_id 应被拒绝（纵深防御）。
    #[test]
    fn valid_session_id_rejects_injection_and_edge_cases() {
        // 命令注入载荷：含 ; 空格 / 等，必须拒绝。
        assert!(!is_valid_session_id("x; rm -rf /"));
        assert!(!is_valid_session_id("$(whoami)"));
        assert!(!is_valid_session_id("a|b"));
        assert!(!is_valid_session_id("a&&b"));
        assert!(!is_valid_session_id("a b")); // 空格
        assert!(!is_valid_session_id("")); // 空串
        // 超长（129 字符）应被拒绝。
        assert!(!is_valid_session_id(&"a".repeat(129)));
        // 边界：128 字符恰好允许。
        assert!(is_valid_session_id(&"a".repeat(128)));
    }
}
