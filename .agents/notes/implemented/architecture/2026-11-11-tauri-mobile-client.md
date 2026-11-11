# Agent Note: Tauri 移动客户端使用独立外壳与受限原生传输

Status: implemented

## Problem

用户确认 iPhone、Android 均以 Tauri 2 App 为目标。桌面入口只用 isTauri 区分环境，会让移动外壳误调本机 PB 和桌面命令。桌面 crate 包含 PTY、sidecar、托盘与全局快捷键，直接编译到移动平台存在依赖边界问题。现有 Web 依赖同源 HttpOnly/Secure/SameSite=Lax cookie，本地 WebView 改 baseURL 无法消除跨站 cookie 与 CORS 限制。

## Decision

移动客户端放在 apps/mobile；前端入口在 src/mobile，独立 Vite 构建打包本地 UI，复用 src/types/session.ts。独立 Tauri crate 不包含桌面进程能力。原生网络桥只提供 pair、sessions、timeline、disconnect 四个命令，使用现有网关协议。它限定 HTTPS 根 origin、正常验证证书、禁重定向、设置超时；配对 cookie 留在原生内存，JavaScript 不获得凭据。初期进程重启需要重新配对，不把凭据落到 localStorage 或配置文件。

原生侧与 UI 的连接生命周期独立于页面请求生命周期。同一连接的401必须回配对页，即使用户已离开产生请求的页面；断开后的旧结果不得恢复列表。客户端功能只读，但服务端签发的既有设备 token 没有只读 scope，不能宣称服务器权限被降级。

## Boundaries

第一阶段只读取会话与时间线，不初始化 PB、不连接终端 WebSocket。现有 WS 缺失会话时可启动 PTY，不能用它实现声称只读的查看页。后续接管原终端需要进程实例身份和 attach-only 协议；推送需要原生 APNs/FCM 与深链接，不以 Web Push 冒充原生推送。

历史审计：主工作区此前无 .agents/notes 目录，无已有移动架构笔记可更新。旧 PWA 设计保留其通知目标推导并在文首标记已被当前原生路线取代。

## Alternatives considered

- 直接复用 WebApp：复用最多，但会误入桌面 invoke/PB 分支，且隐藏按钮并不能阻止终端创建或PB写操作。
- 独立远程 HTTPS WebView：同源 cookie 最易复用，适合快速验证；本地离线状态、版本控制和后续原生能力隔离较复杂，因此本轮使用本地 UI。
- 新设备 Bearer 与安全存储：长期可提供明确的权限 scope 与持久配对，但需要改动服务端认证、系统存储和迁移协议。本轮仅内存保留现有cookie，把该能力留到后续阶段。
- 放宽 CORS 或 SameSite、关闭证书验证：可省开发步骤，却改变现有 Web 安全边界；不采用。

## Consequences

移动构建不下载桌面 PocketBase，也不影响原有工作区未提交功能。代价是多一个应用入口与原生 crate；当前只覆盖配对与会话查看，不能宣称完整移动产品已交付。测试覆盖协议构造、地址/凭据验证、错误状态、UI异步顺序，构建与真机记录见 apps/mobile/README.md。当前 Windows 环境的测试不能替代 Android/iOS 安装、证书、前后台、输入法和推送验收。
