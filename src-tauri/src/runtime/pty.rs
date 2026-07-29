//! 交互式 PTY 进程：把任意本机命令 spawn 进伪终端，输出经 Tauri 事件推前端并 tee 日志，
//! stdin 经命令回传。用于需交互输入的启动（sudo 密码、ssh 指纹、任意 read 提示）。
//!
//! 与 `web/terminal.rs` 的 `PtyRegistry` 独立：那个只跑 provider CLI 的 argv（web 攻击面，
//! 严格 argv 化）；本模块跑桌面手动启动的任意 shell 命令（与 headless `handle_start` 同信任模型）。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tauri::{AppHandle, Emitter};

use super::store;

/// 构建交互 PTY 的 shell 调用（与 headless 手动启动同壳，命令语义一致）。
/// command 作 shell 的**单一参数**传入，元字符不额外拆分（不引入新注入面）。
pub fn build_shell_invocation(command: &str) -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        // chcp 65001 强制子进程 UTF-8 输出，避免 GBK 乱码（与 daemon.rs 一致）
        (
            "cmd".to_string(),
            vec!["/C".to_string(), format!("chcp 65001>nul && {command}")],
        )
    }
    #[cfg(unix)]
    {
        ("sh".to_string(), vec!["-c".to_string(), command.to_string()])
    }
}

/// 单个交互 PTY 会话：writer(=stdin)、master(resize/克隆 reader)、child(kill/收尸)。
struct InteractivePtySession {
    /// 子进程 stdin 写端。丢弃它会给 slave 发 EOF，故与会话同生命周期。
    writer: Box<dyn Write + Send>,
    /// PTY master 端：resize / 克隆 reader 都走它。
    master: Box<dyn MasterPty + Send>,
    /// 子进程句柄：kill / 回收。`Send + Sync` 以便跨线程持有。
    child: Box<dyn Child + Send + Sync>,
}

/// 交互 PTY 注册表：`进程 id -> 会话`。挂 `AppState`（`Arc` 共享），供命令与退出钩子访问。
#[allow(dead_code)] // Task 3 接线后移除
pub struct InteractivePtyRegistry {
    sessions: Mutex<HashMap<String, InteractivePtySession>>,
}

impl Default for InteractivePtyRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl InteractivePtyRegistry {
    pub fn new() -> Self {
        Self { sessions: Mutex::new(HashMap::new()) }
    }

    /// 开一个交互 PTY 会话跑 `command`，起 reader 线程 emit 输出 + tee 日志。
    ///
    /// # 安全约束
    /// - `command` 作 shell 的**单一参数**传入，不二次拼接进 shell 字符串。
    /// - 密码等运行时输入只经 PTY stdin 透传，不落日志（tee 只写 PTY 输出）。
    pub fn open(
        self: &Arc<Self>,
        app: AppHandle,
        id: &str,
        command: &str,
        cwd: &str,
        env: &HashMap<String, String>,
        log_path: PathBuf,
    ) -> Result<(), String> {
        // 拒绝重复 id：否则旧 child 被顶掉后无人 kill，泄漏子进程。
        if self.sessions.lock().contains_key(id) {
            return Err(format!("交互 PTY 会话已存在: {id}"));
        }

        // 开 PTY：默认 80x24；前端连上后会 resize 到真实尺寸。
        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("openpty 失败: {e}"))?;

        // shell 单参数化：command 不拼进 shell 字符串，只作 shell 的单一参数（安全红线）。
        let (prog, args) = build_shell_invocation(command);
        let mut builder = CommandBuilder::new(&prog);
        for a in &args {
            builder.arg(a);
        }
        builder.cwd(cwd);
        // 注入额外环境变量（调用方决定，不由本模块默认扩展）
        for (k, v) in env {
            builder.env(k, v);
        }

        // spawn 到 slave 端；spawn 后 slave 即可丢弃（master 仍持 PTY）。
        let child = pair
            .slave
            .spawn_command(builder)
            .map_err(|e| format!("spawn 交互进程失败: {e}"))?;
        // take_writer 只能取一次，随即持有。
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("获取 PTY writer 失败: {e}"))?;
        // 克隆只读 reader 给 reader 线程（master 留在会话表继续 resize）。
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("克隆 PTY reader 失败: {e}"))?;

        self.sessions.lock().insert(
            id.to_string(),
            InteractivePtySession { writer, master: pair.master, child },
        );

        // reader 线程：读 PTY → ① emit 给前端 ② 追加写日志（tee）。
        // EOF/错误 → emit exit 事件 + 收尸 + 标记 exited。
        let reg = Arc::clone(self);
        let id_owned = id.to_string();
        let out_event = format!("runtime-pty-output:{id}");
        let exit_event = format!("runtime-pty-exit:{id}");
        std::thread::spawn(move || {
            let mut reader = reader;
            // 日志文件：只 tee PTY 输出（绝不写 stdin/密码）。
            let mut log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .ok();
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF：PTY 关闭
                    Ok(n) => {
                        let chunk = buf[..n].to_vec();
                        // 输出经 Tauri 事件推前端（payload = number[]，前端转 Uint8Array）
                        let _ = app.emit(&out_event, chunk.clone());
                        // tee 到日志文件（仅输出，不含 stdin/密码）
                        if let Some(f) = log.as_mut() {
                            let _ = f.write_all(&chunk);
                        }
                    }
                    Err(_) => break, // 读错误（含子进程退出后 master 报错）：结束
                }
            }
            // 退出：收尸移除会话、标记进程表 exited、通知前端。
            reg.remove_finished(&id_owned);
            store::update_process(&id_owned, |e| e.status = "exited".to_string());
            let _ = app.emit(&exit_event, ());
        });

        Ok(())
    }

    /// 写 stdin（前端键入 → PTY）。data 为原始字节（含密码），绝不落日志。
    pub fn input(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut guard = self.sessions.lock();
        let s = guard.get_mut(id).ok_or_else(|| format!("交互 PTY 会话不存在: {id}"))?;
        s.writer.write_all(data).map_err(|e| format!("写 PTY 失败: {e}"))?;
        // 交互式 CLI 依赖及时刷新：不 flush 可能让输入卡在缓冲区。
        s.writer.flush().map_err(|e| format!("flush PTY 失败: {e}"))
    }

    /// 调整 PTY 窗口尺寸（前端 resize 时同步，触发子进程 SIGWINCH/重排）。
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let guard = self.sessions.lock();
        let s = guard.get(id).ok_or_else(|| format!("交互 PTY 会话不存在: {id}"))?;
        s.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("resize PTY 失败: {e}"))
    }

    /// reader 线程退出时调用：从表移除会话并 wait 收尸（child 已自然退出）。
    fn remove_finished(&self, id: &str) {
        if let Some(mut s) = self.sessions.lock().remove(id) {
            let _ = s.child.wait(); // 收尸，杜绝僵尸进程
        }
    }

    /// 主动终止会话：kill + wait + 移除（供 stop 命令 / 退出清场用）。
    /// 摘出会话后在锁外 kill，避免锁内做耗时操作。
    pub fn kill(&self, id: &str) -> Result<(), String> {
        // 先从表摘出（只 remove 在持锁期间完成）。
        let mut s = {
            let mut guard = self.sessions.lock();
            guard.remove(id).ok_or_else(|| format!("交互 PTY 会话不存在: {id}"))?
        };
        // kill 需 &mut；子进程可能已自然退出，此时 kill 报错忽略（视为已终止）。
        let res = s.child.kill().map_err(|e| format!("kill 交互进程失败: {e}"));
        // 收尸：wait 回收退出状态，杜绝僵尸/句柄泄漏（无论 kill 成败都要 reap）。
        let _ = s.child.wait();
        // session 在此出作用域析构：master/writer 关闭，PTY 资源回收。
        res
    }

    /// 清场全表（app 退出钩子调用），杜绝孤儿进程。
    pub fn kill_all(&self) {
        // drain 一次性摘出全表；对每个会话 kill + wait 收尸。已退出的 kill 报错忽略。
        let drained: Vec<(String, InteractivePtySession)> =
            { self.sessions.lock().drain().collect() };
        for (_id, mut s) in drained {
            let _ = s.child.kill();
            let _ = s.child.wait();
        }
    }
}

/// Drop 兜底：任何路径下 registry 被 drop 时清场残留子进程。
/// app 退出的**主动**清场由 Task 3 的退出钩子调用 `kill_all`；本 Drop 是最终兜底。
impl Drop for InteractivePtyRegistry {
    fn drop(&mut self) {
        let mut guard = self.sessions.lock();
        for (_id, mut s) in guard.drain() {
            let _ = s.child.kill(); // 已退出的报错可忽略
            let _ = s.child.wait(); // 收尸，避免僵尸
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// command 必须作 shell 的单一参数传入（含 `;` 等元字符不拆分）。
    #[test]
    fn shell_invocation_passes_command_as_single_arg() {
        let (prog, args) = build_shell_invocation("sudo whoami; echo hi");
        #[cfg(unix)]
        {
            assert_eq!(prog, "sh");
            assert_eq!(args, vec!["-c".to_string(), "sudo whoami; echo hi".to_string()]);
        }
        #[cfg(windows)]
        {
            assert_eq!(prog, "cmd");
            assert_eq!(args[0], "/C");
            // chcp 前缀 + 原命令作单段（不因 ; 而拆成多参数）
            assert!(args[1].starts_with("chcp 65001>nul &&"));
            assert!(args[1].ends_with("sudo whoami; echo hi"));
            assert_eq!(args.len(), 2);
        }
    }
}
