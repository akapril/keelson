# Tauri Mobile P1 Implementation Plan

> For agentic workers: use subagent-driven-development or executing-plans task-by-task. Steps use checkbox tracking.

**Goal:** 本地打包的 Tauri Android/iOS 客户端连接电脑，配对并读取会话列表和完整记录。

**Architecture:** apps/mobile 为独立 Tauri crate 和 Vite 构建，不编译桌面 PocketBase、PTY、托盘、全局快捷键。复用 src/types/session.ts 与视觉基础；原生受限 Rust 命令访问既有 HTTPS 网关，cookie 不交给 JS。不会加载远程网页并授予本机命令。

**Tech Stack:** Tauri 2、React 19、TypeScript、Vite、reqwest、serde、Vitest。

## Global Constraints

- 用户已确认 iOS/Android 都支持，最终为 App；此前 PWA 设计仅描述 Web 阶段。
- 主工作区存在大量未提交改动；不覆盖、不一起提交。文件改动集中在 apps/mobile、src/mobile 和本计划/设计。
- HTTPS 正常证书校验，禁跟随重定向；主机只允许根 origin，不接受凭据/query/fragment/路径。
- 第一阶段 cookie 仅原生内存保存，进程重启后重新配对；安全持久化与原生推送另行实现。
- 不改现有服务器认证、CORS、PB 授权，不导出 PB token，不实现任意 URL fetch 命令。
- 先测试失败，再实现 URL、API 和 UI 行为；真机未测不得标记通过。

## Task 1: Native client (mobile-native)

Files: apps/mobile/src-tauri/** only.

Interfaces (Tauri invoke names and payloads):
- mobile_pair({host:string, code:string}): Promise<void>
- mobile_sessions(): Promise<Session[]>
- mobile_timeline({provider:string, sessionId:string}): Promise<TimelineMessage[]>
- mobile_disconnect(): Promise<void>

- [x] 测试 HTTPS 主机规范化：拒绝 http/userinfo/query/hash/path；接受 Tailscale HTTPS origin。
- [x] 测试配对 cookie 解析、无 cookie 的失败、cookie 不包含控制字符。
- [x] 实现 POST /pair、POST /api/sessions_list、POST /api/sessions_timeline；明确认证/权限/网络失败，禁重定向。
- [x] 401 清除已配对状态；disconnect 清除凭据；并发请求不得把旧主机凭据写回新连接。
- [x] 配置本地 main 窗口和四个受限命令，无 remote capability、desktop sidecar 或启动钩子。
- [x] cargo test：协议与状态测试通过；独立记录移动工具链缺失。

## Task 2: Bundled mobile UI (lead)

Files: src/mobile/MobileApp.tsx, src/mobile/MobileApp.test.tsx, src/mobile/client.ts, src/mobile/main.tsx, src/mobile/mobile.css; apps/mobile/index.html, apps/mobile/vite.config.ts, apps/mobile/tsconfig.json.

UI consumes the four native interfaces above. Inject a MobileClient into MobileApp for deterministic component tests; default implementation calls Tauri invoke. Share Session/TimelineMessage types from src/types/session.ts.

- [x] 组件测试：输入 HTTPS 主机与配对码，pair 成功后自动拉取会话。
- [x] 列表测试：列表为空、网络失败、刷新；点击会话后使用 provider/sessionId 读取并展示记录。
- [x] 断开测试：清理列表/记录/配对码；拒绝新会话被旧异步响应覆盖。
- [x] 本地 UI 不在 localStorage 保存配对码/cookie/会话正文；只可记住主机地址。
- [x] 实现 loading/error/empty、连接/断开、会话列表、记录详情；44px 触控区、16px 输入、安全区和可滚动正文。
- [x] 复用现有颜色基础，移动端克制单列设计；明确当前版本只读，推送与终端输入不展示为已具备。
- [x] 单独 Vite 配置端口1430，输出 apps/mobile/dist；不运行根 prebuild PocketBase 下载。
- [x] Vitest 目标测试 + tsc mobile + Vite production build 通过。

## Task 3: Integration and documentation (lead)

Files: apps/mobile/README.md, design note, mobile config/hooks as needed in coordination with native owner.

- [x] 复核 invoke camelCase 与 Rust 参数匹配、网关响应形状、鉴权失败UI和cookie隔离。
- [ ] 使用模拟网关验证真实 native request 序列。当前已验证实际 reqwest Request 构造与取消状态机；尚未运行 TLS mock I/O 或真实主机端到端，明确记入 README 的后续验收。
- [x] 记录 Android init/dev/build 与 macOS iOS init/dev/build 命令；验证 CLI 发现独立项目配置。
- [x] 记录当前机器 Java/Rust/Android SDK 情况，不安装大体积SDK或生成未验证安装包。
- [x] 记录真机验收：两平台连接、错误配对、读取、刷新、主机离线、凭据吊销、重启重配。
- [x] 审查最终差异，确认无关主工作区改动保留，不自动发布。
