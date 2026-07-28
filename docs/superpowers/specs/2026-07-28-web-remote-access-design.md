# Keelson Web 端 + 外网访问设计

> 状态：设计已确认，待写实现计划。日期：2026-07-28。
> 对标：vibecafe / Vibe X（移动优先、经 tunnel 远程操作本机 CLI agent）。

## 目标

让用户从**外部网络（手机浏览器为主）远程操作运行 Keelson 的那台机器上的 CLI agent**（Claude Code / Codex）——创建/恢复会话、实时看 agent 输出、完整键盘交互（含 ESC/Ctrl-C 等控制键）。核心是一个"远程终端"体验，外加轻量的工作台/通知/设置外壳。

## 非目标（MVP 明确不做）

- 不把桌面全功能搬到 web：看板 / 文档 / 日历 / 独立 AI Chat 面板 / RAG / 记忆栏 **不上 web**，留后续按需加栏。
- 不给 40+ Tauri command 做全量 HTTP 替身——只暴露 web 4 栏用得到的少数。
- 不自建 relay / 中继服务器（vibecafe 那种"零配置扫码"需要运营服务端，MVP 不碰）。
- 不改动桌面版的免登录 bootstrap（本地信任不变，token 只守外网 HTTP 入口）。
- 不做多用户账号体系（Phase ⑤ 的事，非本功能前提）。

## MVP 形态与功能边界

vibex 形态：左侧 4 栏外壳（工作台 / 终端 / 通知 / 设置），主角是右侧可实时交互的终端。

- **终端栏（核心，做深）**：列本机 CLI 会话（复用会话扫描）+ 新建 + 恢复，全部改走 **PTY**；内嵌 xterm.js + WebSocket 实时流；**完整交互键**（文本 + ESC/Ctrl-C/Ctrl-D/方向/Tab/Shift-Tab/Enter）；移动端**虚拟按键条**。
- **工作台栏（浅）**：最近会话/项目入口列表，点击开终端；不做编辑。
- **通知栏（浅、只读）**：复用现有 PB `notifications`，只读展示。
- **设置栏（最小）**：已配对设备管理（吊销 token）、tunnel 地址/状态、语言。

## 架构：可选的 Web Gateway

Keelson 桌面进程内新增 `web` 模块——一个**默认关闭、设置里开启**的 axum HTTP+WS server，绑 `0.0.0.0:<port>`（端口可配）。四类职责：

1. **静态前端**：serve 现有 React `dist`（复用同一份构建，不做第二套前端工程）。
2. **PTY 终端 WS**：见下节，核心。
3. **PB 反代**：`/pb/*` → 转发 `127.0.0.1:<pbPort>` 的 PocketBase（浏览器无法直连远程本机的 127.0.0.1，必须同源反代）。
4. **少量 HTTP command endpoint**：`/api/<cmd>`，仅暴露 web 4 栏用到的 command（如会话列表）。

复用现状：`axum 0.8` 已在 `Cargo.toml`（MCP server 在用），tokio full、reqwest stream 均已具备。PTY 需新增 `portable-pty` 依赖。

**关键取舍**：因功能边界"终端深、其余浅"，MVP **无需搬迁 40+ command**——web 端只碰少数 command，其余在 web 端不渲染对应 UI，从根本上限制了工作量。

## PTY 终端子系统（核心）

- 新增 `portable-pty`（跨平台：Windows ConPTY / Unix pty）。
- `src-tauri/src/web/terminal.rs`：会话表 `session_id → { pty_master, child }`。开终端 = portable-pty 在 `project_path` 拉起 claude/codex（复用现有 provider registry 的 `start_command`/`resume_command` 字符串）。
- WS `/ws/terminal/:id`：tokio 双向泵——
  - pty stdout（字节流）→ WS 二进制帧 → 前端 xterm.js 写入；
  - 前端键盘/控制键 → WS → pty stdin；
  - `resize` 控制帧（cols/rows）→ pty 尺寸调整。
- 前端 `src/features/webterm/`（或共享 `src/components/terminal/`）：xterm.js 组件 + fit addon + 移动虚拟键条。
- 生命周期：pty 子进程退出 → WS 发退出帧 + 清理会话表条目；WS 断连不杀 pty（允许重连接管，像 vibex 的 reconnect）。

## ipc.ts 双通道抽象

- 环境探测：`isTauri = typeof window.__TAURI__ !== "undefined"`。
- Tauri 环境：现状 `invoke`。web 环境：`fetch('/api/<cmd>', {POST, body: args})`。
- **command 逻辑复用**：把要 web 化的少数 command 主体抽成 `core fn(state, args) -> Result`，`#[tauri::command]` 与 axum handler 都是薄 wrapper 调同一 core（不重写逻辑，保证两路一致）。
- **流式**：`ai_chat_stream` 现用 Tauri Channel；web 分支需 WS/SSE 替代。MVP 若不做 web 端独立 AI chat 面板，则**不适配**（终端里的 agent 流走 PTY WS，与此无关）。
- web 端未实现的 ipc 方法：对应 UI 不在 web 布局渲染，不会被调用。

## PB 经 web 访问

- 前端 PB SDK baseURL 按环境切：Tauri → `http://127.0.0.1:<pbPort>` 直连；web → 同源 `/pb`（经 Gateway 反代）。
- 反代请求经 token 中间件；PB 内部仍免登录（信任已过闸请求）。

## 认证与安全

- Gateway 启动生成**高熵配对码**（≥32 字节随机，设置页显示）。
- `POST /pair`：收配对码 → 校验（常量时间比较）→ 签发长效**签名 token**，写 httpOnly cookie。
- **中间件**：除 `/pair` 与静态资源外，所有请求（`/pb/*`、`/ws/*`、`/api/*`）需 valid token；校验失败限流（防爆破）。
- 设置栏：列已配对设备（token 摘要 + 首次配对时间）+ 逐个吊销（作废对应 token）。
- **安全底线**（远程终端 = 远程任意命令执行，高危）：token 高熵 + 可吊销 + 仅经 HTTPS（Tailscale/tunnel 提供 TLS）+ 失败限流 + 强烈建议叠 Tailscale 私有网做网络层纵深。

## 移动优先 UI 与布局分叉

- web 端是**一套移动优先的响应式界面**（专为窄屏设计，桌面浏览器向上适配加宽），非两套工程、非给桌面组件加断点。
- **共享底层**：同一 React 代码库、组件库、store、`ipc.ts`、类型、xterm 终端组件。
- **顶层布局分叉**：入口按 `isTauri` 选布局——Tauri 渲染现有桌面布局；web 渲染新的移动优先 4 栏布局。**一份 `dist`**。
- 终端虚拟键条：移动窄屏显示，桌面浏览器（有物理键盘）隐藏。
- 连接态指示：像 vibex 的 `Connecting/Connected` 角标（WS/tunnel 状态可见）。

## Tunnel（Tailscale，外置）

- 默认方案 **Tailscale 私有网**：用户装 Tailscale，Keelson Gateway 绑 `0.0.0.0`，经 tailnet 访问（WireGuard 网络层认证 + app token 双层）。
- Keelson **不内置管理 tunnel**，仅文档引导。
- 可选（文档提及、非默认）：Cloudflare Tunnel + Access（要自有域名）。frp/ngrok 不推荐。

## 桌面反哺（backlog，非 MVP 强制）

内嵌 PTY 终端组件做出后，桌面版可把"开外部终端窗口"升级为"应用内嵌终端"。架构支持，MVP 先只 web 用，列入 backlog 作自然延伸。

## 错误处理

- pty 子进程退出：WS 退出帧 + 清理会话表 + 前端提示。
- WS 断连：前端自动重连、接管既有 pty（不丢会话）。
- token 失效/被吊销：踢回配对页。
- PB 反代失败：前端错误态。
- tunnel 断：连接态角标反映。

## 测试

- PTY 会话生命周期（开启/输出/输入/resize/子进程退出/清理）。
- WS 协议帧（输入 / 输出 / resize / 退出四类）。
- token 中间件（无 token 拦截 / 有效放行 / 吊销后拒绝 / 失败限流）；pairing 与 token 签发/校验纯函数（常量时间比较）。
- `isTauri` 分支切换（同一 ipc 方法 Tauri 走 invoke、web 走 fetch）。
- core fn 复用一致性（同一逻辑经 IPC 与 HTTP 两路结果一致）。
- PB 反代路由（同源 `/pb` 正确转发 + 认证拦截）。

## 实现阶段（供 writing-plans 分批）

1. **地基**：`web` 模块 axum server（默认关、设置开）+ 静态前端 serve + token 认证中间件 + `/pair` + 配对码生成 + 设置栏配对/吊销。端到端：本机浏览器输配对码 → 进入空 web 布局。
2. **PB 反代 + 浅栏数据**：`/pb/*` 反代 + PB SDK baseURL 环境切 + 工作台/通知栏（会话列表、只读通知）。
3. **PTY 终端核心**：`portable-pty` + `web/terminal.rs` 会话表 + `/ws/terminal/:id` 双向泵 + core fn 复用 provider 命令。
4. **终端前端 + 移动 UI**：xterm.js 组件 + fit + 虚拟键条 + 移动优先 4 栏布局 + `isTauri` 布局分叉 + 连接态角标。
5. **tunnel 文档 + 收尾**：Tailscale 引导文档、错误态打磨、全量校验。

## 全局约束

- 内部代号 `rework` 冻结：不出现在 web 端用户可见文案（沿用 Keelson 品牌）；`com.rework.app`、hook 标记、localStorage 功能键不动。
- 桌面免登录 bootstrap 不变；token 仅守外网 HTTP 入口。
- 中文注释；不硬编码颜色（沿用中性主题 CSS 变量）；store 写失败重抛 + 调用点 toast。
- 复用现有：provider registry（终端命令）、会话扫描、PB `notifications`、i18n（web 端文案走已建 i18n）。
- 安全优先：任何暴露到外网入口的路径必须经 token 中间件，无例外（除 `/pair` 与静态资源）。
