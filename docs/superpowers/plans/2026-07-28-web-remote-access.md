# Web 端 + 外网访问 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户从外网手机浏览器远程操作运行 Keelson 的本机 CLI agent（Claude/Codex）——实时终端交互为核心，配轻量工作台/通知/设置外壳。

**Architecture:** Keelson 桌面进程内起一个默认关闭、设置里开启的 axum HTTP+WS Web Gateway（绑 `0.0.0.0`），职责：serve 现有 React dist、PTY 终端 WS、PB 反代、少量 HTTP command。前端一份 dist 按 `isTauri` 分叉布局（桌面 vs 移动优先 web）。外网穿透外置给 Tailscale。认证用高熵配对 token 守外网入口。

**Tech Stack:** Rust（axum 0.8 已有、tokio full、portable-pty 新增）、React 19/TS、xterm.js（新增）、PocketBase SDK、i18next。

## Global Constraints

- 复用现有：axum（MCP server `src-tauri/src/mcp/server.rs` 在用）、provider registry（`state.reg.by_id(id).resume_command/start_command`）、会话扫描、PB `notifications` 集合、i18n（web 文案走已建 i18n）。
- 新增依赖仅 `portable-pty`（Rust）与 `@xterm/xterm` + `@xterm/addon-fit`（前端）；不引入其它。
- Token：高熵（≥32 字节随机）+ 可吊销 + 失败限流 + 常量时间比较（用 `subtle` crate，项目已有 ct_eq 惯例见 MCP Bearer）。
- command 主体抽 `core fn(state, args) -> Result`，`#[tauri::command]` 与 axum handler 都是薄 wrapper 调同一 core。
- `ipc.ts` 按 `isTauri` 双通道：Tauri→`invoke`，web→`fetch('/api/<cmd>')`。
- 移动优先单套响应式；入口按 `isTauri` 布局分叉；一份 dist。
- 桌面免登录 bootstrap 不变；token 只守外网 HTTP 入口。
- 内部代号 `rework` 冻结：不出现在 web 端用户可见文案；`com.rework.app`、hook 标记、localStorage 功能键（如 `rework-remote-pb-url`）不动。
- 安全铁律：除 `/pair` 与静态资源外，所有外网入口路径（`/pb/*`、`/ws/*`、`/api/*`）必经 token 中间件，无例外。
- 中文注释；不硬编码颜色（中性主题语义类）；store 写失败重抛 + 调用点 toast。
- Rust 单测本机 `cargo test --lib` 有 Tauri+Windows `0xc0000139` 平台限制（见项目记忆），纯逻辑用 standalone `rustc --test` 验证，CI(ubuntu) 跑全量；`cargo build` 0 error 作接线验收。

---

## File Structure

**Rust 新建：**
- `src-tauri/src/web/mod.rs` — Web Gateway 模块入口，`pub use` 子模块。
- `src-tauri/src/web/auth.rs` — 配对码生成、token 签发/校验（纯函数）、设备表、限流。
- `src-tauri/src/web/server.rs` — axum server 起停（绑 0.0.0.0）、路由装配、token 中间件、静态 serve。
- `src-tauri/src/web/pb_proxy.rs` — `/pb/*` 反向代理到本地 PB。
- `src-tauri/src/web/terminal.rs` — PTY 会话表 + `/ws/terminal/:id` 双向泵。
- `src-tauri/src/web/api.rs` — `/api/<cmd>` HTTP endpoint（少量，调 core fn）。
- `src-tauri/src/commands/web.rs` — Tauri command：gateway 起停/状态、配对码、设备列表/吊销。

**Rust 修改：**
- `src-tauri/Cargo.toml` — 加 `portable-pty`。
- `src-tauri/src/lib.rs` — `mod web;`、AppState 加 gateway 句柄、注册 web command。
- `src-tauri/src/commands/sessions.rs` 等 — 抽 core fn（阶段②按需）。

**前端新建：**
- `src/lib/env.ts` — `isTauri` 检测。
- `src/web/WebApp.tsx` — 移动优先 4 栏布局根。
- `src/web/PairScreen.tsx` — 配对页。
- `src/web/panels/{Workbench,Terminal,Notifications,Settings}.tsx` — 4 栏。
- `src/components/terminal/XtermView.tsx` — xterm 组件（桌面反哺共享）。
- `src/web/webterm-ws.ts` — 终端 WS 客户端。
- `src/features/settings/WebGatewaySection.tsx` — 桌面设置栏：gateway 开关 + 配对/设备。

**前端修改：**
- `src/main.tsx` / `src/App.tsx` — `isTauri` 布局分叉。
- `src/lib/tauri/ipc.ts` — 双通道抽象。
- `src/lib/pb.ts` — web 环境 baseURL = 同源 `/pb`。

---

## 阶段① 地基

### Task 1: Web Gateway 骨架 + 起停 command（绑 0.0.0.0，先只 serve 健康 + 静态占位）

**Files:**
- Create: `src-tauri/src/web/mod.rs`, `src-tauri/src/web/server.rs`
- Create: `src-tauri/src/commands/web.rs`
- Modify: `src-tauri/src/lib.rs`（`mod web;` + AppState 字段 + generate_handler）
- Modify: `src-tauri/Cargo.toml`（本任务先不加 portable-pty，阶段③再加）

**Interfaces:**
- Produces: `web::server::start(app, port) -> Result<u16, String>`（绑 `0.0.0.0:port`，port=0 随机；返回实际端口）；`web::server::stop()`。
- Produces: `AppState.web_gateway: Arc<Mutex<Option<GatewayHandle>>>`，`GatewayHandle { port: u16, shutdown: tokio::sync::oneshot::Sender<()> }`。
- Produces: command `web_gateway_start(state) -> Result<u16,String>`、`web_gateway_stop(state) -> Result<(),String>`、`web_gateway_status(state) -> Result<Option<u16>,String>`。

- [ ] **Step 1: 写 server.rs 起停 + 健康路由（参照 mcp/server.rs 的 axum 模式）**

```rust
//! Web Gateway：外网可达的 axum HTTP+WS server。默认关闭，由设置开启。
use axum::{routing::get, Router};
use std::net::SocketAddr;
use tokio::sync::oneshot;

pub struct GatewayHandle {
    pub port: u16,
    pub shutdown: oneshot::Sender<()>,
}

/// 起 gateway，绑 0.0.0.0:port（port=0 随机）。返回实际端口。
pub async fn start(port: u16) -> Result<(u16, GatewayHandle), String> {
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|e| format!("绑定失败: {e}"))?;
    let actual = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (tx, rx) = oneshot::channel();
    let router = Router::new().route("/healthz", get(|| async { "ok" }));
    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async { let _ = rx.await; })
            .await;
    });
    Ok((actual, GatewayHandle { port: actual, shutdown: tx }))
}
```

- [ ] **Step 2: 写 commands/web.rs 起停命令**

```rust
use crate::AppState;
use tauri::State;

#[tauri::command]
pub async fn web_gateway_start(state: State<'_, AppState>) -> Result<u16, String> {
    if let Some(h) = state.web_gateway.lock().as_ref() { return Ok(h.port); }
    let (port, handle) = crate::web::server::start(0).await?;
    *state.web_gateway.lock() = Some(handle);
    Ok(port)
}

#[tauri::command]
pub fn web_gateway_stop(state: State<AppState>) -> Result<(), String> {
    if let Some(h) = state.web_gateway.lock().take() { let _ = h.shutdown.send(()); }
    Ok(())
}

#[tauri::command]
pub fn web_gateway_status(state: State<AppState>) -> Result<Option<u16>, String> {
    Ok(state.web_gateway.lock().as_ref().map(|h| h.port))
}
```

- [ ] **Step 3: lib.rs 接线**：加 `mod web;`；`AppState` 加 `pub web_gateway: Arc<Mutex<Option<web::server::GatewayHandle>>>`（`impl Default` 初始化 `None`）；`generate_handler!` 加三个 command。

- [ ] **Step 4: 编译验证**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 0 error。（GatewayHandle 的 `oneshot::Sender` 非 Clone，AppState 存 Option 里 take 即可。）

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/web src-tauri/src/commands/web.rs src-tauri/src/lib.rs
git commit -m "feat(web): Web Gateway 骨架 + 起停命令(绑 0.0.0.0/健康路由)"
```

### Task 2: 认证 core —— 配对码 + token 签发/校验（纯函数，standalone 可测）

**Files:**
- Create: `src-tauri/src/web/auth.rs`
- Modify: `src-tauri/src/web/mod.rs`（`pub mod auth;`）

**Interfaces:**
- Produces: `gen_pairing_code() -> String`（32 字节随机 → base64url）。
- Produces: `struct AuthState { pairing_code: String, secret: [u8;32], devices: Mutex<Vec<Device>>, fails: Mutex<RateLimit> }`。
- Produces: `Device { id: String, token_hash: [u8;32], paired_at: String, label: String }`。
- Produces: `issue_token(&AuthState, label) -> String`（高熵 token；存其 hash 到 devices）；`verify_token(&AuthState, token) -> bool`（常量时间比较 hash）；`revoke(&AuthState, device_id)`；`check_pairing(&AuthState, code) -> bool`（常量时间 + 限流）。

- [ ] **Step 1: 写失败测试（standalone 逻辑）**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn issued_token_verifies_and_revokes() {
        let a = AuthState::new_with_code("CODE".into());
        let tok = issue_token(&a, "phone".into());
        assert!(verify_token(&a, &tok));
        assert!(!verify_token(&a, "wrong"));
        let dev = a.devices.lock().unwrap()[0].id.clone();
        revoke(&a, &dev);
        assert!(!verify_token(&a, &tok)); // 吊销后失效
    }
    #[test]
    fn pairing_constant_time_and_reject_wrong() {
        let a = AuthState::new_with_code("SECRET".into());
        assert!(check_pairing(&a, "SECRET"));
        assert!(!check_pairing(&a, "nope"));
    }
}
```

- [ ] **Step 2: standalone 跑测确认失败**：`rustc --test` 抽出 auth 纯逻辑单独编译（避开 Tauri 平台限制），Expected: FAIL（未实现）。

- [ ] **Step 3: 实现 auth.rs**（token = 32 字节随机 base64url；存 SHA-256 hash；`verify_token` 用 `subtle::ConstantTimeEq` 逐 device hash 比对；`check_pairing` 常量时间 + 简单计数限流：连续失败 N 次后拉长间隔）。用 `rand`、`sha2`、`subtle`、`base64`（确认 Cargo 已有或加，`subtle` MCP 已用）。

- [ ] **Step 4: standalone 跑测确认通过** + `cargo build`。

- [ ] **Step 5: 提交** `git commit -m "feat(web): 配对码+token 签发/校验/吊销(常量时间+限流)"`

### Task 3: axum 认证中间件 + /pair + 静态前端 serve

**Files:**
- Modify: `src-tauri/src/web/server.rs`（挂中间件、`/pair` 路由、`ServeDir` 静态）
- Modify: `src-tauri/src/lib.rs`（AppState 加 `web_auth: Arc<web::auth::AuthState>`）

**Interfaces:**
- Consumes: `web::auth::{check_pairing, issue_token, verify_token}`。
- Produces: 路由 `POST /pair`（body `{code}` → 校验 → set-cookie token）、`GET /*`（静态 dist，未认证也放行 index 以便渲染配对页）、`/api|/pb|/ws` 经 `require_token` 中间件。

- [ ] **Step 1: 写中间件与 /pair**（`require_token`：从 cookie 取 token，`verify_token` 失败返回 401；`/pair` 成功 `Set-Cookie: kln_token=...; HttpOnly; Secure; SameSite=Strict`）。静态用 `tower_http::services::ServeDir` 指向 dist（`tower-http` 若无则加 feature `fs`）。

代码骨架：
```rust
async fn require_token(State(auth): State<Arc<AuthState>>, jar: CookieJar, req: Request, next: Next) -> Result<Response, StatusCode> {
    let tok = jar.get("kln_token").map(|c| c.value().to_string()).unwrap_or_default();
    if verify_token(&auth, &tok) { Ok(next.run(req).await) } else { Err(StatusCode::UNAUTHORIZED) }
}
```
路由装配：受保护子路由 `.layer(middleware::from_fn_with_state(auth.clone(), require_token))`，`/pair` 与静态在闸外。

- [ ] **Step 2: dist 路径**：release 用打包资源；dev 指向 `../dist`。用 `app.path()` 解析或配置常量；找不到 dist 时 `/` 返回占位 HTML（"web dist 未构建"）不 panic。

- [ ] **Step 3: 编译验证** `cargo build` 0 error。

- [ ] **Step 4: 手动冒烟（报告记录）**：起 gateway（临时测试入口或后续 Task 5 GUI），`curl -i localhost:<port>/api/ping` 应 401，`curl -X POST .../pair -d '{"code":"<配对码>"}'` 应 set-cookie，带 cookie 再访问 `/api` 应放行。（本地 curl 验证，非单测。）

- [ ] **Step 5: 提交** `git commit -m "feat(web): token 中间件+/pair+静态前端 serve"`

### Task 4: 前端 —— isTauri 检测 + web 配对页 + web 空布局（端到端）

**Files:**
- Create: `src/lib/env.ts`, `src/web/WebApp.tsx`, `src/web/PairScreen.tsx`
- Modify: `src/main.tsx`（按 isTauri 选根组件）

**Interfaces:**
- Produces: `isTauri(): boolean`（`typeof (window as any).__TAURI_INTERNALS__ !== "undefined"`）。
- Produces: web 入口渲染 `<WebApp/>`：未配对（无 cookie/401）→ `<PairScreen/>`（输配对码 POST /pair）；已配对 → 空的 4 栏骨架（本 Task 栏内容留空占位）。

- [ ] **Step 1: 写 env.ts**（`isTauri` 检测）+ 测试（mock window 两态）。
- [ ] **Step 2: main.tsx 分叉**：`isTauri() ? <App/> : <WebApp/>`（App 是现有桌面根）。
- [ ] **Step 3: PairScreen**：输入框 + 提交 `fetch('/pair',{method:POST,body:JSON.stringify({code})})`，成功刷新进 WebApp；失败 toast。文案走 i18n（新 `web` 命名空间，中英）。
- [ ] **Step 4: WebApp 骨架**：移动优先容器 + 底部/侧 4 栏 tab（工作台/终端/通知/设置，内容占位）。用现有组件库、语义色。
- [ ] **Step 5: 验证** `pnpm exec tsc --noEmit` + `pnpm test`（env.ts 测试）绿；`pnpm build` 产出 dist 供 gateway serve。
- [ ] **Step 6: 端到端手验**：`web_gateway_start` → 浏览器开 `localhost:<port>` → 配对页 → 输码 → 进 4 栏空布局。报告记录。
- [ ] **Step 7: 提交** `git commit -m "feat(web): isTauri 分叉+配对页+web 4栏空布局(端到端通)"`

### Task 5: 设置栏 WebGatewaySection（开关 + 配对码 + 设备管理）

**Files:**
- Create: `src/features/settings/WebGatewaySection.tsx`
- Modify: `src/pages/settings.tsx`（接入）
- Modify: `src-tauri/src/commands/web.rs`（`web_pairing_code`、`web_list_devices`、`web_revoke_device`）
- Modify: `src/lib/tauri/ipc.ts`（对应方法）

**Interfaces:**
- Produces command: `web_pairing_code(state)->String`、`web_list_devices(state)->Vec<DeviceInfo>`、`web_revoke_device(state,id)->()`。
- Produces: 设置栏——开关起停 gateway（显示端口/tunnel 提示）、显示配对码、列已配对设备 + 吊销。

- [ ] **Step 1-5**：command（调 auth）→ ipc 方法 → Section 组件（开关调 `web_gateway_start/stop`，展示 `web_gateway_status` 端口 + 配对码；设备列表 + 吊销按钮，操作后刷新）→ 接入 settings 页 → i18n 文案 → tsc/test/lint 绿 → 提交 `feat(web): 设置栏 gateway 开关+配对码+设备吊销`。

---

## 阶段② PB 反代 + 浅栏数据

### Task 6: /pb/* 反向代理

**Files:** Create `src-tauri/src/web/pb_proxy.rs`；Modify `server.rs`（挂 `/pb/*path` 在 token 闸内）。

**Interfaces:** Produces `pb_proxy_handler`：把 `/pb/*` 请求（含 method/headers/body/query）转发到 `http://127.0.0.1:<pbPort>/*`，回传响应。用 `reqwest`（已有）。

- [ ] Step 1: 从 AppState/bootstrap 拿 PB 端口（现有 `pb_data_dir`/bootstrap 已知端口，暴露一个 `pb_base()`）。
- [ ] Step 2: 写透传 handler（保留 status/headers/body；流式响应用 reqwest stream）。
- [ ] Step 3: `cargo build` + curl 冒烟：带 token cookie `curl localhost:<port>/pb/api/health` 命中 PB。
- [ ] Step 4: 提交 `feat(web): PB 同源反代 /pb/*`

### Task 7: 前端 PB baseURL 环境切 + ipc.ts 双通道基础

**Files:** Modify `src/lib/pb.ts`（web 环境 baseURL=`/pb`）、`src/lib/tauri/ipc.ts`（双通道）。

**Interfaces:**
- Consumes: `isTauri()`。
- Produces: web 环境 `pb.baseURL = location.origin + "/pb"`（并跳过 bootstrap invoke，用 cookie 会话）；`ipc.<m>` 内部 `isTauri() ? invoke(cmd,args) : fetch('/api/'+cmd,{POST,body:args}).then(r=>r.json())`。

- [ ] Step 1: 写 ipc 双通道内部 helper `call<T>(cmd,args)`，各 `ipc.*` 方法改调它（保持对外签名不变）。测试：mock isTauri 两态，断言走 invoke vs fetch。
- [ ] Step 2: pb.ts initPbAuth 加 web 分支（baseURL=/pb；web 端 PB 认证 MVP 用反代 + gateway token 即可，PB 侧沿用本地免登录 token——从 `/api/bootstrap_auth` 取或反代 health 后免登录）。
- [ ] Step 3: tsc/test 绿。提交 `feat(web): PB baseURL 环境切+ipc 双通道`

### Task 8: 工作台栏（会话列表，core fn 复用）

**Files:** Modify `src-tauri/src/commands/sessions.rs`（抽 `sessions_list` core fn）、`src-tauri/src/web/api.rs`（`/api/sessions_list` 调 core）、`src/web/panels/Workbench.tsx`。

- [ ] Step 1: 抽 `sessions::core::list(state)->Vec<Session>`，Tauri command 与 api handler 都调它。测试：core fn 返回结构一致。
- [ ] Step 2: `/api/sessions_list` handler（token 闸内）。
- [ ] Step 3: Workbench 栏用 `ipc.listSessions()`（web 走 /api）渲染最近会话/项目列表，点击切到终端栏（占位跳转，终端阶段④接）。
- [ ] Step 4: tsc/test/build 绿 + curl 冒烟。提交 `feat(web): 工作台栏会话列表(core fn 双路复用)`

### Task 9: 通知栏（PB notifications 只读）

**Files:** Create `src/web/panels/Notifications.tsx`。

- [ ] Step 1: 复用现有 PB `notifications` 集合读取（经 /pb 反代，PB SDK 已切 baseURL），只读列表渲染（未读高亮）。
- [ ] Step 2: i18n 文案；移动优先样式。tsc/test 绿。提交 `feat(web): 通知栏只读展示`

---

## 阶段③ PTY 终端核心

### Task 10: portable-pty 封装 + 会话表 + core fn 复用 provider 命令

**Files:** Modify `Cargo.toml`（加 `portable-pty`）；Create `src-tauri/src/web/terminal.rs`。

**Interfaces:**
- Produces: `struct PtySession { writer: Box<dyn Write+Send>, master: Box<dyn MasterPty+Send>, child: Box<dyn Child+Send> }`。
- Produces: `PtyRegistry`（`Mutex<HashMap<String, PtySession>>`）：`open(id, provider, project_path, state) -> Result<()>`（用 `state.reg.by_id(provider).start_command/resume_command` 拿命令，portable-pty spawn，cwd=project_path）；`write(id, bytes)`；`resize(id, cols, rows)`；`take_reader(id) -> Box<dyn Read+Send>`；`kill(id)`。

- [ ] Step 1: 加依赖 `portable-pty = "0.8"`。
- [ ] Step 2: 写 open/write/resize/kill（portable-pty `native_pty_system().openpty(PtySize{...})`，`CommandBuilder` 解析 provider 命令字符串 + cwd，spawn 到 slave；master 拿 reader/writer）。命令字符串解析用现有 provider 命令（复用，不新造）。
- [ ] Step 3: `cargo build` 0 error。纯逻辑（命令字符串→CommandBuilder 拆分）用 standalone rustc 测。
- [ ] Step 4: 提交 `feat(web): portable-pty 会话表(开/写/resize/kill,复用 provider 命令)`

### Task 11: /ws/terminal/:id 双向泵

**Files:** Modify `src-tauri/src/web/server.rs`（挂 ws 路由，token 闸内）；`terminal.rs`（ws handler）。

**Interfaces:** Produces WS `/ws/terminal/:id?provider=&path=`：升级后——(a) 若会话不存在则 `PtyRegistry::open`；(b) spawn 读 pty→ws（二进制帧）；(c) 收 ws→pty（文本=stdin，控制帧 JSON `{type:"resize",cols,rows}` / `{type:"key",data}`）；(d) pty 退出→发 `{type:"exit"}` 关 ws + 清理。

- [ ] Step 1: axum `WebSocketUpgrade`（token 闸内，握手前校验 cookie token）。
- [ ] Step 2: 双向 tokio task（`tokio::select!` 泵读写；pty reader 在 blocking 线程 → channel → ws）。resize/exit 协议帧。
- [ ] Step 3: `cargo build` 0 error。协议帧解析纯逻辑 standalone 测。
- [ ] Step 4: 提交 `feat(web): /ws/terminal 双向泵(pty<->ws,resize/exit 协议)`

---

## 阶段④ 终端前端 + 移动 UI

### Task 12: XtermView 组件 + WS 客户端

**Files:** Create `src/components/terminal/XtermView.tsx`, `src/web/webterm-ws.ts`；Modify `package.json`（`@xterm/xterm`,`@xterm/addon-fit`）。

**Interfaces:**
- Produces: `<XtermView sessionId provider projectPath/>`：挂载 xterm + FitAddon，连 `webterm-ws`（ws://同源 /ws/terminal/:id），pty 输出 write 到 term，term `onData` → ws；ResizeObserver → fit + 发 resize 帧。
- Produces: `openTerminalWs(id, params, {onData,onExit})`：WebSocket 封装（同源 ws、断线重连、二进制/JSON 帧分发）。

- [ ] Step 1: 装依赖。写 webterm-ws（帧编解码 + 重连）。测试：mock WebSocket，断言输入帧/resize 帧格式、exit 回调。
- [ ] Step 2: XtermView（xterm 初始化、fit、双向接线、卸载清理）。
- [ ] Step 3: tsc/test/build 绿。提交 `feat(web): xterm 终端组件+WS 客户端(重连/resize)`

### Task 13: 移动优先 4 栏布局 + 终端栏接入 + 虚拟键条 + 连接态角标

**Files:** Modify `src/web/WebApp.tsx`、`src/web/panels/Terminal.tsx`；Create 虚拟键条组件。

- [ ] Step 1: 终端栏：会话列表（复用 workbench 数据）→ 选中开 `<XtermView/>`；新建会话入口。
- [ ] Step 2: 虚拟按键条（移动窄屏显示、桌面隐藏）：ESC/Ctrl-C/Ctrl-D/↑↓←→/Tab/Shift-Tab，点击 → 发对应字节到 ws（如 Ctrl-C=`\x03`、ESC=`\x1b`、方向=`\x1b[A` 等）。
- [ ] Step 3: 连接态角标（Connecting/Connected/Reconnecting，绑 ws 状态）。
- [ ] Step 4: 4 栏布局响应式收口（移动底 tab / 桌面浏览器加宽）。i18n 文案。
- [ ] Step 5: tsc/test/build 绿 + 端到端手验（浏览器开终端、输入、按 Ctrl-C 中断、resize）。提交 `feat(web): 终端栏+虚拟键条+连接态角标+移动4栏布局`

---

## 阶段⑤ tunnel 文档 + 收尾

### Task 14: Tailscale 文档 + gateway 端口设置 + 全量校验

**Files:** Create `docs/web-remote-access.md`；Modify 设置栏（端口/绑定说明 + tunnel 状态提示）。

- [ ] Step 1: 写 Tailscale 引导文档（装 tailscale、私有网访问 `http://<tailscale-ip>:<port>`、可选 funnel、安全提示：配对 token + 私有网双层）。
- [ ] Step 2: 设置栏展示 gateway 访问地址提示（本机 IP/tailscale 提示）+ 端口可配（可选，MVP 随机端口够）。
- [ ] Step 3: 全量校验：`pnpm test && pnpm exec tsc --noEmit && pnpm lint && cargo build`（cargo test --lib 平台限制，CI 验证）。
- [ ] Step 4: 提交 `docs(web): Tailscale 接入文档 + gateway 地址提示 + 全量校验`

---

## Self-Review 结论

- **Spec 覆盖**：Web Gateway 起停（T1）、认证 token/配对/吊销（T2/T3/T5）、静态 serve（T3）、isTauri 分叉+配对页（T4）、PB 反代（T6）、PB baseURL 环境切+ipc 双通道（T7）、工作台/通知浅栏（T8/T9）、PTY 会话表 core 复用（T10）、WS 双向泵（T11）、xterm+WS 客户端（T12）、终端栏+虚拟键条+连接态+移动布局（T13）、Tailscale 文档（T14）——spec 各节均有对应 task。桌面反哺列 spec backlog，不进本 plan（YAGNI）。
- **占位符**：无 TBD/TODO；PTY/WS 集成 task 给核心骨架 + 接口契约 + 验收，属探索性集成的合理粒度（crate API 明确指向 portable-pty / axum ws）。
- **类型一致**：`web_gateway_start/stop/status`、`AuthState`/`verify_token`/`issue_token`/`revoke`/`check_pairing`、`GatewayHandle{port,shutdown}`、`PtyRegistry::{open,write,resize,kill,take_reader}`、WS 协议帧 `{type:resize|key|exit}`、`isTauri()`、`ipc.call<T>(cmd,args)` 跨 task 一致。
- **安全**：`/pb|/api|/ws` 全在 token 闸内（T3 中间件 + T6/T8/T11 挂载点复述），`/pair` 与静态在闸外——与 spec 铁律一致。
