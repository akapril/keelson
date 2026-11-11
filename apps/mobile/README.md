# Keelson Mobile · 第一阶段预览

独立的 Tauri 2 Android/iOS 客户端入口，本地打包 React UI，通过受限原生 HTTPS 命令连接电脑上的 Keelson Web 网关。目前支持手动输入地址/配对码、刷新会话列表、阅读完整对话、断开连接；不含终端输入、原生通知、扫码、持久配对或应用商店发行。

## 连接条件

电脑运行 Keelson 并开启 Web 网关，`sessions` 功能开启；手机能够访问具有有效证书的 HTTPS 根地址，例如 Tailscale Serve 地址。不能填写 HTTP、子路径、查询参数或用户名密码。配对码用一次后会在主机轮换。

配对凭据仅保留在 Rust 内存，重启后重新配对。JS 不保存 cookie、配对码或会话正文。认证失效返回配对页，功能关闭提示权限错误；普通网络失败允许刷新重试。断开不会吊销服务器中的设备记录；需要永久吊销时在电脑的配对设备管理中操作。

此版本仅提供读取功能，但复用的服务器设备 token 仍具有现有 Web 权限；它没有服务器端 `sessions:read` scope。不要把客户端只读界面视为服务端权限隔离。

## 项目边界

- `src-tauri` 是独立 Rust crate，无桌面 PocketBase、PTY、托盘或全局快捷键依赖。
- UI 源码在仓库 `src/mobile`，复用 `src/types/session.ts`。Vite 输出当前目录 `dist`。
- 不调用根项目 `pnpm build`，避免触发桌面 PocketBase 下载。
- 四个本地命令：`mobile_pair`、`mobile_sessions`、`mobile_timeline`、`mobile_disconnect`。没有任意 URL fetch 或远程网页的原生命令授权。
- 不使用 WebView 跨站 cookie；由原生请求按所选主机发送内存 cookie，禁重定向，保留 TLS 验证。

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

`Mobile test APK` 流程在 `mobile-android-test` 分支的相关代码推送时运行，另保留手动触发入口（工作流需先存在默认分支才会显示该入口）。使用 GitHub Linux runner 安装 SDK/NDK，执行前端与原生测试，再生成 ARM64 调试 APK。

构建成功后，在 Actions 运行页下载 `keelson-mobile-android-debug` Artifact，解压并安装 `Keelson-Mobile-test-arm64.apk`。同包提供 SHA256、签名验证、包信息与源码 commit。Artifact 保留14天；不创建 tag、GitHub Release 或应用商店版本。流程只有 `contents: read` 权限，不使用发布证书。

调试签名由临时 runner 生成，跨次构建可能不同；若覆盖安装提示签名不一致，卸载旧测试版后安装新包。此包只面向 ARM64 Android 手机，不适用于 iPhone 或 x86 模拟器。

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

2026-11-11：前端 8 项测试、独立 TypeScript 检查、Vite 生产打包通过；检查了窄屏连接页布局。测试包括无效配对重试、会话读取、断开后旧结果隔离、返回列表后的401处理、错误响应数据形状。

原生 core 5 项测试通过，验证 URL/cookie、请求方法/路径/JSON/Cookie、错误状态及在途请求取消/新连接隔离；Windows `cargo check --offline --features shell` 通过。这些是协议构造与状态机测试，不是真实网关端到端联调；尚未运行 TLS mock I/O。

当前机器有 Java 17 和 Windows MSVC/Rust；PATH 中无 adb，ANDROID_HOME/ANDROID_SDK_ROOT 未配置，未发现可用 Android 构建环境。未执行 Android/iOS build、真机安装或真实 HTTPS 主机配对；本次没有 APK/IPA 交付，也未改动系统证书或安装 SDK。

真机验收必须分别覆盖：正确/错误配对码、有效/无效证书、列表与完整记录、离线重试、设备吊销401、功能关闭403、弱网断开、切换主机、应用重启重新配对、前后台恢复、安全区、键盘与大字体。此矩阵通过后才能称为可用移动版本。

后续顺序：原终端 attach-only 与实例身份 → 安全凭据持久化 → APNs/FCM 推送与精确深链接 → 双平台真机与签名发布。

设计依据见仓库 `.agents/notes/implemented/architecture/2026-11-11-tauri-mobile-client.md` 与 `docs/superpowers/plans/2026-11-11-tauri-mobile-p1.md`。
