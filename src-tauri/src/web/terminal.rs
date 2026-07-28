//! Web 远程终端：内嵌伪终端（PTY）会话表。
//!
//! 与 `commands/terminal.rs`（用系统终端窗口起 CLI）不同，本模块**不开外部窗口**：
//! 在本进程内用 portable-pty 拉起一个伪终端，把 provider 的 CLI agent（claude/codex）
//! spawn 进 PTY 的 slave 端，master 端持有其 stdin(writer)/stdout+stderr(reader)。
//! 这样 Task 11 的 WebSocket handler 就能双向泵：浏览器键入 → `write`；PTY 输出 → reader。
//!
//! ## provider 命令复用
//! provider registry 返回的是 **shell 命令字符串**（如 `claude --resume <id>`，可能含参数/引号）。
//! 为避免手写命令行解析踩引号/空格坑，本模块**用系统 shell 包一层**复用该字符串：
//! - Windows：`cmd.exe /C <cmd>`
//! - Unix：  `sh -c <cmd>`
//! shell 以 `cwd=project_path` 起，再由 shell 执行 provider 命令；CLI agent 继承 PTY 交互正常。
//!
//! ## 并发
//! 会话表用 parking_lot `Mutex`（项目惯例，`.lock()` 无 `unwrap`）。`PtyRegistry` 挂在
//! `AppState` 上以 `Arc` 共享，供 gateway WS handler 访问。
//!
//! 「选 shell + 组装命令行 argv」被抽成纯函数 [`build_shell_argv`]，无任何 IO / PTY 依赖，
//! 可 standalone（`rustc --test`）验证（参照 `web/auth.rs` 手法）。

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
    /// 1. `native_pty_system().openpty(PtySize{rows,cols})` 得到 master/slave 对。
    /// 2. 用 provider 命令字符串经 [`build_shell_argv`] 组装成「系统 shell + -c/-C + 命令」argv。
    /// 3. `CommandBuilder` 起 shell、`cwd=project_path`，spawn 到 slave。
    /// 4. 取 writer（仅一次）、存 master/writer/child 到会话表。
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

        // 1. 经 registry 路由 provider，生成命令字符串（复用现有 start/resume_command）。
        let p = reg
            .by_id(provider)
            .ok_or_else(|| format!("未知 provider: {provider}"))?;
        let cmd = match session_id {
            Some(sid) => p.resume_command(project_path, sid),
            None => p.start_command(None),
        };

        // 2. 选 shell + 组装 argv（纯函数，可 standalone 测）。
        let argv = build_shell_argv(&cmd);

        // 3. 开 PTY。默认 80x24；前端连上后会立即 resize 到真实终端尺寸。
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty 失败: {e}"))?;

        // 4. 组装 CommandBuilder：argv[0]=shell，其余为参数；cwd=项目目录。
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

    /// 终止会话：kill 子进程并从表中移除（连同 master/writer 一并 drop，释放 PTY）。
    ///
    /// 移除的会话被返回持有到函数末尾再析构：在持锁期间只做 `kill`（内部仅发信号/终止，不阻塞），
    /// drop（可能触发 writer EOF / 句柄关闭）放到锁释放后，避免长时间持锁。
    pub fn kill(&self, id: &str) -> Result<(), String> {
        // 先从表中摘出会话（持锁期间完成 remove + kill）。
        let mut session = {
            let mut guard = self.sessions.lock();
            guard
                .remove(id)
                .ok_or_else(|| format!("PTY 会话不存在: {id}"))?
        };
        // kill 需 &mut self；子进程可能已自然退出，此时 kill 报错可忽略（视为已终止）。
        let res = session.child.kill().map_err(|e| format!("kill 子进程失败: {e}"));
        // session 在此出作用域析构：master/writer 关闭，PTY 资源回收。
        res
    }
}

/// 纯函数：为「用系统 shell 执行一段命令字符串」组装 argv。
///
/// 返回的 `Vec<String>`：`argv[0]` = shell 可执行名，其余为参数，最后一个是原样透传的命令字符串。
/// **不做任何命令行拆分**——正是为了避免手写解析踩引号/空格坑：让 shell 自己去解析。
///
/// - Windows：`["cmd.exe", "/C", <cmd>]`
/// - 其他平台：`["sh", "-c", <cmd>]`
///
/// 该函数无 IO / PTY 依赖，可在 standalone `rustc --test` 中直接验证（含 `#[cfg]` 双平台断言）。
pub fn build_shell_argv(cmd: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        // cmd.exe /C "<命令>"：/C 执行随后命令串并退出。命令串整体作为**一个** argv 元素透传，
        // 由 cmd.exe 自行解析引号/空格，我方不拆分。
        vec!["cmd.exe".to_string(), "/C".to_string(), cmd.to_string()]
    }
    #[cfg(not(windows))]
    {
        // sh -c '<命令>'：-c 后整串作为一个参数交给 sh 解析。
        vec!["sh".to_string(), "-c".to_string(), cmd.to_string()]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// shell argv 组装：命令字符串整体作为最后一个 argv 元素透传（不拆分），
    /// 引号/空格交给 shell 解析。双平台分别断言 shell 与开关。
    #[test]
    fn build_shell_argv_wraps_command_as_single_arg() {
        let argv = build_shell_argv("claude --resume abc \"hi there\"");
        // 恒为 3 段：shell + 开关 + 原样命令串。
        assert_eq!(argv.len(), 3);
        // 命令串原样透传，含引号与空格，未被拆分。
        assert_eq!(argv[2], "claude --resume abc \"hi there\"");

        #[cfg(windows)]
        {
            assert_eq!(argv[0], "cmd.exe");
            assert_eq!(argv[1], "/C");
        }
        #[cfg(not(windows))]
        {
            assert_eq!(argv[0], "sh");
            assert_eq!(argv[1], "-c");
        }
    }

    /// 空命令串也应产出合法 3 段 argv（shell 会起一个空/交互 shell，不 panic）。
    #[test]
    fn build_shell_argv_handles_empty() {
        let argv = build_shell_argv("");
        assert_eq!(argv.len(), 3);
        assert_eq!(argv[2], "");
    }

    /// 含分号/管道等 shell 元字符时同样原样透传——由 shell 解释，我方不干预。
    #[test]
    fn build_shell_argv_preserves_metachars() {
        let cmd = "codex resume 'x y' && echo done";
        let argv = build_shell_argv(cmd);
        assert_eq!(argv[2], cmd);
    }
}
