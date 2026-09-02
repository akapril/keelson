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

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tokio::sync::{broadcast, watch};

/// 每会话输出环形缓冲上限（字节）：供刷新/重连时回放最近历史。512KB 够看最近多屏。
const SCROLLBACK_CAP: usize = 512 * 1024;
/// 输出广播通道容量（每订阅者滞后超过此数会 Lagged，丢中间帧但缓冲仍有历史）。
const OUTPUT_CHANNEL_CAP: usize = 1024;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::response::Response;

use crate::providers::ProviderRegistry;
use crate::web::server::WsTerminalState;

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
    /// 输出广播：常驻抽取线程把 PTY 输出发到此处，当前连着的 WS 订阅收实时字节。
    /// 独立于 WS 生命周期——断连不影响抽取，agent 永不因 stdout 满而阻塞。
    output_tx: broadcast::Sender<Vec<u8>>,
    /// 输出环形缓冲（有上限）：供刷新/重连时回放最近历史，xterm 用原始字节重绘。
    scrollback: Arc<Mutex<VecDeque<u8>>>,
    /// 退出信号：常驻抽取线程读到 EOF（PTY 关闭）时 send(true)。WS handler watch 之以感知退出。
    exit_tx: watch::Sender<bool>,
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

        // 4. 组装 CommandBuilder；cwd=项目目录。
        //    - 非 Windows：argv[0]=CLI 二进制，其余为独立参数，直传不经 shell（元字符不被解释 → 无注入）。
        //    - Windows：npm 装的 claude/codex 是**无扩展名 shell 脚本**（`...\npm\codex`），CreateProcessW
        //      直接 spawn 报 `os error 193`（「不是有效的 Win32 应用程序」）。故经 `cmd /c` 让系统按
        //      PATHEXT 解析到 `.cmd`/`.exe`。argv 已校验（session_id 白名单 / provider 来自注册表 /
        //      其余为字面量 "resume"/"--resume"），不含 cmd 元字符 → 无注入面。
        #[cfg(windows)]
        let mut builder = {
            let mut b = CommandBuilder::new("cmd");
            b.arg("/c");
            for a in &argv {
                b.arg(a);
            }
            b
        };
        #[cfg(not(windows))]
        let mut builder = {
            let mut b = CommandBuilder::new(&argv[0]);
            for a in &argv[1..] {
                b.arg(a);
            }
            b
        };
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
        // 克隆只读句柄给常驻抽取线程（master 仍留会话表继续 resize）。
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("克隆 PTY reader 失败: {e}"))?;

        // 7. 输出通道：广播(实时) + 环形缓冲(回放) + 退出 watch。
        let (output_tx, _) = broadcast::channel::<Vec<u8>>(OUTPUT_CHANNEL_CAP);
        let scrollback = Arc::new(Mutex::new(VecDeque::<u8>::new()));
        let (exit_tx, _exit_rx) = watch::channel(false);

        // 8. 常驻抽取线程：持续 drain PTY → 环形缓冲 + 广播；EOF 置退出信号。
        //    独立于 WS 生命周期——断连也照抽干，agent 输出不会因无人读而阻塞卡死。
        {
            let sb = Arc::clone(&scrollback);
            let otx = output_tx.clone();
            let etx = exit_tx.clone();
            let mut reader = reader;
            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break, // EOF：PTY 关闭
                        Ok(n) => {
                            let chunk = &buf[..n];
                            // 环形缓冲追加 + 广播 在同一把 scrollback 锁内完成：使"回放快照"与
                            // "实时订阅"对每个 chunk 原子——重连接管无缝隙、无重复帧。
                            // 无订阅者时 send 返回 Err，忽略（字节已进缓冲，供下次回放）。
                            let mut g = sb.lock();
                            g.extend(chunk.iter().copied());
                            let over = g.len().saturating_sub(SCROLLBACK_CAP);
                            if over > 0 {
                                g.drain(0..over);
                            }
                            let _ = otx.send(chunk.to_vec());
                            drop(g);
                        }
                        Err(_) => break, // 读错误（含子进程退出后 master 报错）
                    }
                }
                let _ = etx.send(true); // 通知所有 watch 订阅者：PTY 已退出
            });
        }

        let session = PtySession {
            writer,
            master: pair.master,
            child,
            output_tx,
            scrollback,
            exit_tx,
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

    /// 接管一个会话的输出流：返回 (环形缓冲快照, 实时输出订阅, 退出信号订阅)。
    ///
    /// WS 连接/重连时调用：先把 `快照` 回放给 xterm（重绘刷新前的历史，实现"不被打断"），
    /// 再订阅 `广播` 收实时字节、`watch` 感知 PTY 退出。会话不存在返回 None。
    pub fn attach(
        &self,
        id: &str,
    ) -> Option<(Vec<u8>, broadcast::Receiver<Vec<u8>>, watch::Receiver<bool>)> {
        let guard = self.sessions.lock();
        let s = guard.get(id)?;
        // 持 scrollback 锁期间订阅 + 快照，与 drain 的"push+send 同锁"配对 → 每 chunk 原子，
        // 回放与实时之间无缝隙、无重复（锁序 sessions→scrollback，drain 只持 scrollback，无环）。
        let sb = s.scrollback.lock();
        let rx = s.output_tx.subscribe();
        let snapshot: Vec<u8> = sb.iter().copied().collect();
        drop(sb);
        Some((snapshot, rx, s.exit_tx.subscribe()))
    }

    /// 判断某会话是否已存在（供 WS handler 决定「新开」还是「接管重连」）。
    pub fn exists(&self, id: &str) -> bool {
        self.sessions.lock().contains_key(id)
    }

    /// 主动清场：kill 全表所有会话并收尸。供 gateway stop / app exit 的退出钩子调用，
    /// 杜绝孤儿 CLI agent（`Drop for PtyRegistry` 是最终兜底，此方法是**主动**触发路径）。
    ///
    /// WS 断连**不**调用本方法（允许前端重连接管）；仅在 gateway 停止或 app 退出时调用。
    pub fn kill_all(&self) {
        // drain 一次性摘出全表；对每个会话 kill + wait 收尸。已退出的 kill 报错忽略。
        let drained: Vec<(String, PtySession)> = {
            let mut guard = self.sessions.lock();
            guard.drain().collect()
        };
        for (_id, mut session) in drained {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
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

/// 校验 project_path 是否合法（非空、绝对路径；拒绝任意相对路径/空串）。
///
/// Task 10 转交·安全：project_path 作为 PTY 的 cwd 传入，必须是明确的绝对路径，
/// 不接受空串或相对路径（避免 cwd 落到进程当前目录等非预期位置）。
/// 绝对路径判定用 [`std::path::Path::is_absolute`]（跨平台：Windows 认盘符/UNC，*nix 认前导 `/`）。
/// 纯函数，无 IO，可 standalone 测。
pub fn is_valid_project_path(p: &str) -> bool {
    !p.trim().is_empty() && std::path::Path::new(p).is_absolute()
}

/// I-1 纵深防御：校验 project_path 是否属于已知项目集合（来自会话列表去重）。
///
/// 已鉴权的 WS 连接仍可传入任意绝对路径（如 `/`、`/etc`、`C:\Windows`）作为 PTY cwd，
/// 本函数在第一道绝对路径校验之后追加第二道：path 必须出现在当前 sessions 的
/// `project_path` 集合中，否则拒绝 open PTY。
///
/// 设计说明：
/// - 集合来源：调用方在持有锁期间收集所有 `session.project_path`，**释放锁后**再调用本函数
///   （不跨 await 持 parking_lot guard）。
/// - 空集合拒绝：sessions 为空时集合为空，返回 false（fail-safe）。
/// - 纯函数，无 IO，可 standalone 测。
pub fn is_project_path_in_known_sessions(path: &str, known_paths: &std::collections::HashSet<String>) -> bool {
    known_paths.contains(path)
}

// ── WS 协议帧解析（纯逻辑，抽出便于 standalone `rustc --test`）───────────────

/// WS 入站帧经解析后的语义：控制指令或标准输入。
///
/// 协议约定（清晰、无歧义）：
/// - **Binary 帧** = 始终当作 stdin 原样喂给 PTY（键入/粘贴的字节流，可含非法 UTF-8）。
/// - **Text 帧且是合法 JSON 控制帧**（`{"type":"resize"|"exit"|...}`）= 控制指令。
/// - **Text 帧但不是控制 JSON** = 也当作 stdin（普通键入文本）。
#[derive(Debug, PartialEq, Eq)]
pub enum InboundFrame {
    /// 调整 PTY 窗口大小。
    Resize { cols: u16, rows: u16 },
    /// stdin 字节流（喂给 PTY writer）。
    Stdin(Vec<u8>),
    /// 忽略（如 ping/pong/close 由上层处理；此处不产生副作用）。
    Ignore,
}

/// 解析一条二进制 WS 帧：Binary 恒为 stdin。
pub fn parse_binary_frame(bytes: Vec<u8>) -> InboundFrame {
    InboundFrame::Stdin(bytes)
}

/// 解析一条文本 WS 帧：
/// - 若能解析为控制 JSON（`{"type":"resize",...}`）→ 对应控制指令；
/// - 否则整段文本按 stdin 处理（普通键入）。
///
/// resize 帧需同时含合法 `cols`/`rows`（u16 范围内正整数）；缺字段/越界/type 未知
/// → 不当控制帧，回落为 stdin（fail-safe：宁可把控制帧误当输入，也不静默丢弃用户数据）。
pub fn parse_text_frame(text: &str) -> InboundFrame {
    // 仅当能解析成 JSON 对象且带已知 "type" 时才视作控制帧。
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(text) {
        if let Some(t) = v.get("type").and_then(|t| t.as_str()) {
            match t {
                "resize" => {
                    // cols/rows 必须是 1..=u16::MAX 的整数；任一非法则回落为 stdin。
                    let cols = v.get("cols").and_then(|c| c.as_u64());
                    let rows = v.get("rows").and_then(|r| r.as_u64());
                    if let (Some(c), Some(r)) = (cols, rows) {
                        if (1..=u16::MAX as u64).contains(&c) && (1..=u16::MAX as u64).contains(&r) {
                            return InboundFrame::Resize {
                                cols: c as u16,
                                rows: r as u16,
                            };
                        }
                    }
                    // 非法 resize：不 resize，也不误当输入注入乱码 → 忽略。
                    return InboundFrame::Ignore;
                }
                // 其它已知控制类型（如前端主动 "exit"）：此处不下发到 PTY，交由上层策略。
                "exit" | "ping" => return InboundFrame::Ignore,
                // 未知 type：当作普通输入文本处理。
                _ => {}
            }
        }
    }
    // 非 JSON / 无 type / 未知 type：按 stdin 处理。
    InboundFrame::Stdin(text.as_bytes().to_vec())
}

// ── WS 路由参数 ─────────────────────────────────────────────────────────────

/// `/ws/terminal/{id}` 的 query 参数：`?provider=claude&path=<绝对路径>`。
#[derive(serde::Deserialize)]
pub struct WsTerminalQuery {
    /// provider 标识（"claude" / "codex"），经 `reg.by_id` 白名单路由。
    provider: String,
    /// 项目绝对路径，作为 PTY 的 cwd。
    path: String,
}

// ── WS handler ──────────────────────────────────────────────────────────────

/// `/ws/terminal/{id}` 升级 handler。
///
/// **鉴权前提**：本路由挂在 `require_token` layer **闸内**（非公开白名单），故 axum 在调用
/// 本 handler **之前**已校验 cookie token 通过——未鉴权连接根本不会触达此处，更不会 open PTY。
///
/// 升级前先做参数校验（provider 白名单 / project_path 合法 / id=session_id 白名单）：
/// 任一不合法则**不升级**、直接返回错误响应，绝不 open。全部通过才 `on_upgrade` 建 WS。
pub async fn ws_terminal_handler(
    ws: WebSocketUpgrade,
    Path(id): Path<String>,
    Query(q): Query<WsTerminalQuery>,
    State(st): State<WsTerminalState>,
) -> Response {
    use axum::response::IntoResponse;
    // 1) provider 白名单：未知 provider 直接拒（不升级）。
    if st.reg.by_id(&q.provider).is_none() {
        return (axum::http::StatusCode::BAD_REQUEST, "未知 provider").into_response();
    }
    // 2) id(=session_id) 白名单双保险（open 内亦会校验，这里提前拒以免无谓升级）。
    if !is_valid_session_id(&id) {
        return (axum::http::StatusCode::BAD_REQUEST, "非法会话 id").into_response();
    }
    // 3) project_path 合法性：非空 + 绝对路径（第一道）。
    if !is_valid_project_path(&q.path) {
        return (axum::http::StatusCode::BAD_REQUEST, "非法 project path").into_response();
    }
    // 4) I-1 纵深防御：project_path 必须属于已知项目集合（第二道）。
    //    先取锁收集 HashSet，判定后**释放锁**，再进 WS 升级（不跨 await 持 parking_lot guard）。
    {
        let known_paths: std::collections::HashSet<String> = {
            let guard = st.sessions.lock();
            guard.iter().map(|s| s.project_path.clone()).collect()
        }; // guard 在此释放，不跨 await
        if !is_project_path_in_known_sessions(&q.path, &known_paths) {
            return (axum::http::StatusCode::BAD_REQUEST, "project path 不属于已知项目").into_response();
        }
    }

    // 全部校验通过 → 升级。闭包捕获校验后的参数，在 WS 建立后接管双向泵。
    ws.on_upgrade(move |socket| async move {
        run_terminal_ws(socket, id, q.provider, q.path, st).await;
    })
}

/// WS 建立后的主循环：开/接管 PTY 会话，然后双向泵 pty<->ws，直至任一方结束。
///
/// 生命周期：**WS 断连不杀 pty**（允许重连接管）；仅 pty 自身退出时才主动清理会话。
async fn run_terminal_ws(
    socket: WebSocket,
    id: String,
    provider: String,
    project_path: String,
    st: WsTerminalState,
) {
    use axum::extract::ws::Utf8Bytes;
    use futures_util::{SinkExt, StreamExt};

    // 1) 会话不存在则 open；已存在则直接接管（重连场景，不重复 open）。
    //    id 同时用作 session_id（resume 恢复既有会话）。open 内含 session_id 白名单 + argv 化。
    if !st.pty.exists(&id) {
        if let Err(e) = st
            .pty
            .open(&id, &provider, &project_path, Some(&id), &st.reg)
        {
            // open 失败：告知前端并关闭。不泄露内部细节到日志（此处仅用于前端提示帧）。
            let _ = {
                let (mut tx, _rx) = socket.split();
                tx.send(Message::Text(Utf8Bytes::from(EXIT_FRAME))).await
            };
            // 打印一条不含敏感数据的诊断（provider/id 非敏感；不打印 project_path 全量与 token）。
            eprintln!("[ws-terminal] open 失败(provider={provider}, id={id}): {e}");
            return;
        }
    }

    // 2) 接管输出：环形缓冲快照 + 实时广播订阅 + 退出订阅。会话不存在（罕见）则关闭。
    let (snapshot, mut out_rx, mut exit_rx) = match st.pty.attach(&id) {
        Some(x) => x,
        None => {
            let (mut tx, _rx) = socket.split();
            let _ = tx.send(Message::Text(Utf8Bytes::from(EXIT_FRAME))).await;
            return;
        }
    };

    let (mut ws_tx, mut ws_rx) = socket.split();

    // 3) 回放历史：把刷新/断连前的输出快照发给新 xterm，重绘出上下文——"不被打断"的关键。
    if !snapshot.is_empty() && ws_tx.send(Message::Binary(snapshot.into())).await.is_err() {
        return; // ws 刚建就断：不清理 pty，留待下次重连
    }
    // 3b) 连接前 PTY 已退出：回放完历史后通知 exit 并清理会话。
    if *exit_rx.borrow() {
        let _ = ws_tx.send(Message::Text(Utf8Bytes::from(EXIT_FRAME))).await;
        let _ = st.pty.kill(&id);
        return;
    }

    // 4) 双向泵：广播输出→ws / 退出信号 / ws输入→pty。
    //    handler 内**不持锁跨 await**——write/resize 均为同步方法（锁即取即放）。
    let pty = Arc::clone(&st.pty);
    loop {
        tokio::select! {
            // 4a) 实时输出：广播 → Binary 帧给浏览器。
            r = out_rx.recv() => {
                match r {
                    Ok(bytes) => {
                        if ws_tx.send(Message::Binary(bytes.into())).await.is_err() {
                            break; // ws 断：不杀 pty（重连接管），仅退泵循环
                        }
                    }
                    // 订阅滞后：丢了中间帧（环形缓冲仍留历史）。继续收后续，不中断。
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    // 广播关闭：抽取线程已结束（通常 exit 先触发）。当作退出处理。
                    Err(broadcast::error::RecvError::Closed) => {
                        let _ = ws_tx.send(Message::Text(Utf8Bytes::from(EXIT_FRAME))).await;
                        let _ = pty.kill(&id);
                        return;
                    }
                }
            }
            // 4b) 退出信号：PTY 关闭 → 通知前端 exit + 清理会话。
            changed = exit_rx.changed() => {
                if changed.is_ok() && *exit_rx.borrow() {
                    let _ = ws_tx.send(Message::Text(Utf8Bytes::from(EXIT_FRAME))).await;
                    let _ = pty.kill(&id);
                    return;
                }
            }
            // 4c) 浏览器输入：stdin / resize。
            maybe_msg = ws_rx.next() => {
                match maybe_msg {
                    Some(Ok(Message::Binary(data))) => {
                        if let InboundFrame::Stdin(bytes) = parse_binary_frame(data.to_vec()) {
                            let _ = pty.write(&id, &bytes);
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        match parse_text_frame(text.as_str()) {
                            InboundFrame::Resize { cols, rows } => { let _ = pty.resize(&id, cols, rows); }
                            InboundFrame::Stdin(bytes) => { let _ = pty.write(&id, &bytes); }
                            InboundFrame::Ignore => {}
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break, // 断连：不杀 pty
                    Some(Ok(_)) => { /* Ping/Pong：axum 自动处理 */ }
                    Some(Err(_)) => break,
                }
            }
        }
    }

    // 循环退出 = WS 断连（非 pty 退出）：**不 kill pty**，pty + 常驻抽取线程继续跑等待重连接管。
    // out_rx / exit_rx 在此 drop（退订），不影响抽取线程或其它订阅者。
}

/// pty 退出时发给前端的控制帧（约定：Text JSON `{"type":"exit"}`）。
const EXIT_FRAME: &str = r#"{"type":"exit"}"#;

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

    /// project_path：绝对路径接受，空串/相对路径拒绝。
    #[test]
    fn project_path_requires_absolute_nonempty() {
        // *nix 绝对路径 / Windows 盘符路径至少一种在本平台成立。
        #[cfg(windows)]
        assert!(is_valid_project_path("C:\\workspace\\rework"));
        #[cfg(not(windows))]
        assert!(is_valid_project_path("/home/user/project"));
        // 空串 / 纯空白 / 相对路径一律拒绝。
        assert!(!is_valid_project_path(""));
        assert!(!is_valid_project_path("   "));
        assert!(!is_valid_project_path("relative/path"));
        assert!(!is_valid_project_path("./x"));
    }

    /// Binary 帧恒为 stdin（原样字节，可含非 UTF-8）。
    #[test]
    fn binary_frame_is_stdin() {
        let raw = vec![0x1b, 0x5b, 0x41, 0xff]; // ESC[A + 非法 UTF-8 字节
        assert_eq!(parse_binary_frame(raw.clone()), InboundFrame::Stdin(raw));
    }

    /// 合法 resize 控制帧 → Resize；cols/rows 正确解析。
    #[test]
    fn text_resize_frame_parses() {
        let f = parse_text_frame(r#"{"type":"resize","cols":120,"rows":40}"#);
        assert_eq!(f, InboundFrame::Resize { cols: 120, rows: 40 });
    }

    /// 非法 resize（缺字段 / 越界 / 零值）→ Ignore（不 resize 也不注入乱码）。
    #[test]
    fn text_resize_frame_rejects_invalid() {
        // 缺 rows
        assert_eq!(parse_text_frame(r#"{"type":"resize","cols":80}"#), InboundFrame::Ignore);
        // 越界（> u16::MAX = 65535）
        assert_eq!(
            parse_text_frame(r#"{"type":"resize","cols":70000,"rows":40}"#),
            InboundFrame::Ignore
        );
        // 零值（终端尺寸至少为 1）
        assert_eq!(
            parse_text_frame(r#"{"type":"resize","cols":0,"rows":40}"#),
            InboundFrame::Ignore
        );
    }

    /// 非 JSON / 无 type 的文本帧 → 当作 stdin（普通键入）。
    #[test]
    fn text_non_control_is_stdin() {
        assert_eq!(
            parse_text_frame("ls -la\n"),
            InboundFrame::Stdin(b"ls -la\n".to_vec())
        );
        // 合法 JSON 但无 "type" 字段 → 也当 stdin。
        assert_eq!(
            parse_text_frame(r#"{"foo":1}"#),
            InboundFrame::Stdin(br#"{"foo":1}"#.to_vec())
        );
    }

    /// 已知非输入控制类型（exit/ping）→ Ignore（不下发到 PTY）。
    #[test]
    fn text_known_control_ignored() {
        assert_eq!(parse_text_frame(r#"{"type":"exit"}"#), InboundFrame::Ignore);
        assert_eq!(parse_text_frame(r#"{"type":"ping"}"#), InboundFrame::Ignore);
    }
}
