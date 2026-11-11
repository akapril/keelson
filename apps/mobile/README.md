# Keelson Mobile · 第一阶段预览

独立的 Tauri 2 Android/iOS 客户端入口，本地打包 React UI，通过受限原生命令连接电脑上的 Keelson Web 网关。目前支持手动配对、恢复 Android 配对、刷新会话列表、阅读完整对话、断开连接；不含终端输入、原生通知、扫码或应用商店发行。

## 连接条件

电脑运行 Keelson 并开启 Web 网关，`sessions` 功能开启；通常使用具有有效证书的 HTTPS 根地址，例如 Tailscale Serve 地址。仅 Android debug 包可临时使用带明确端口的 RFC1918 私网 IPv4 HTTP 地址（例如 `http://192.168.10.145:47700`）；release 包仍只允许 HTTPS。拒绝公网上的 HTTP、域名 HTTP、localhost、子路径、查询参数及用户名密码。配对码用一次后会在主机轮换。私网 HTTP 会让同一网络中的流量失去传输加密，只用于可信调试网络。

Android 使用系统 Keystore AES-GCM 在 `noBackupFilesDir` 保存加密配对信息，启动时验证会话；离线保留凭据供重试，401 或主动断开会清除。iOS 暂为内存模式，重启后重新配对。JS 不保存 cookie、配对码或会话正文。功能关闭提示权限错误；断开不会吊销服务器中的设备记录，需要永久吊销时在电脑的配对设备管理中操作。

此版本仅提供读取功能，但复用的服务器设备 token 仍具有现有 Web 权限；它没有服务器端 `sessions:read` scope。不要把客户端只读界面视为服务端权限隔离。

## 项目边界

- `src-tauri` 是独立 Rust crate，无桌面 PocketBase、PTY、托盘或全局快捷键依赖。
- UI 源码在仓库 `src/mobile`，复用 `src/types/session.ts`。Vite 输出当前目录 `dist`。
- 不调用根项目 `pnpm build`，避免触发桌面 PocketBase 下载。
- 五个本地命令：`mobile_restore`、`mobile_pair`、`mobile_sessions`、`mobile_timeline`、`mobile_disconnect`。没有任意 URL fetch 或远程网页的原生命令授权。
- 不使用 WebView 跨站 cookie；由原生请求按所选主机发送认证 cookie，禁重定向，HTTPS 保留 TLS 验证。

## 本地检查

先在仓库根安装既有 pnpm 依赖。下列命令从仓库根运行：

```sh
node node_modules/vitest/vitest.mjs run src/mobile
node node_modules/typescript/bin/tsc -p apps/mobile/tsconfig.json
node node_modules/vite/bin/vite.js build --config apps/mobile/vite.config.ts
cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml --no-default-features
cargo check --manifest-path apps/mobile/src-tauri/Cargo.toml --features shell
```

仅查看布局可使用 `node node_modules/vite/bin/vite.js --config apps/mobile/vite.config.ts`。普通浏览器没有 Tauri 原生桥，无法实际配对；组件测试使用注入的模拟客户端。

## GitHub Actions 测试 APK

`Mobile test APK` 流程在 `mobile-android-test` 分支的相关代码推送时运行，另保留手动触发入口（工作流需先存在默认分支才会显示该入口）。使用 GitHub Linux runner 安装 SDK/NDK，执行前端与原生测试，再分别生成 ARM64 和 x86_64 调试 APK。

构建成功后，在 Actions 运行页下载匹配架构的 `keelson-mobile-android-debug-arm64` 或 `keelson-mobile-android-debug-x86_64` Artifact，解压并安装对应 APK。每包提供 SHA256、签名验证、包信息与源码 commit。Artifact 保留14天；不创建 tag、GitHub Release 或应用商店版本。流程只有 `contents: read` 权限，不使用发布证书。

调试签名由临时 runner 生成，跨次构建可能不同；若覆盖安装提示签名不一致，卸载旧测试版后安装新包。arm64 包面向 ARM64 Android 手机；x86_64 包用于 MuMu 等 x86_64 模拟器，两者均不适用于 iPhone。

## Android 开发

需要 Android Studio SDK、NDK、Java，以及相应 Android Rust targets。按 Tauri 官方要求配置 `ANDROID_HOME`、`NDK_HOME`、`JAVA_HOME` 后，从 `apps/mobile` 运行：

```sh
node ../../node_modules/@tauri-apps/cli/tauri.js android init
node ../../node_modules/@tauri-apps/cli/tauri.js android dev
node ../../node_modules/@tauri-apps/cli/tauri.js android build
```

首次 init 生成的平台工程需要审核并纳入版本控制；本次未生成未经验证的平台工程。发布签名和版本号由发布阶段配置。

## iOS 开发

需要 macOS、Xcode、iOS Rust targets，真机签名需要开发团队配置。从 `apps/mobile` 运行：

```sh
node ../../node_modules/@tauri-apps/cli/tauri.js ios init
node ../../node_modules/@tauri-apps/cli/tauri.js ios dev
node ../../node_modules/@tauri-apps/cli/tauri.js ios build
```

本次 Windows 环境不能完成 iOS 编译或签名，不提供未验证的 IPA。

## 验证记录与缺口

2026-11-11：第一版 ARM64 debug APK 已由 GitHub Actions 成功构建并验证签名；随后增加配对持久化、调试私网 HTTP 和 x86_64 模拟器包，设备端结果以新工作流运行为准。移动前端 17 项测试、TypeScript 检查通过；原生 core 8 项测试覆盖来源限制、协议、状态与401区分；Windows shell `cargo check --locked` 通过。安卓插件的 JVM 加密测试覆盖往返、随机 IV、篡改、截断及错密钥。实际 Keystore instrumentation、模拟器端到端和 iOS 编译/签名尚需完成。

当前机器 Android SDK 在 `D:/Android/Sdk`，MuMu 设备为 x86_64；原 ARM64 包不能安装到 MuMu。真机验收仍需覆盖：正确/错误配对码、有效/无效证书、列表与完整记录、离线重试、设备吊销401、功能关闭403、弱网断开、切换主机、应用重启恢复、前后台恢复、安全区、键盘与大字体。

后续顺序：原终端 attach-only 与实例身份 → APNs/FCM 推送与精确深链接 → 双平台真机与签名发布。

设计依据见仓库 `.agents/notes/implemented/architecture/2026-11-11-tauri-mobile-client.md` 与 `docs/superpowers/plans/2026-11-11-tauri-mobile-p1.md`。
