<div align="center">
  <img src="public/keelson.svg" width="72" height="72" alt="Keelson" />
  <h1>Keelson</h1>
  <p><b>本地优先的 AI 工作台</b> —— 把散落的 AI-CLI 会话、项目、任务、文档收拢到一处。</p>
  <p><sub>简体中文 · <a href="README.en.md">English</a></sub></p>
  <p>
    <img alt="platform" src="https://img.shields.io/badge/平台-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-555" />
    <img alt="stack" src="https://img.shields.io/badge/Tauri%20v2-React%2019-blue" />
    <a href="https://github.com/akapril/keelson/releases"><img alt="release" src="https://img.shields.io/github/v/release/akapril/keelson?include_prereleases&label=下载" /></a>
    <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-green" /></a>
    <a href="https://linux.do"><img alt="LINUX DO" src="https://img.shields.io/badge/LINUX-DO-FFB003" /></a>
  </p>
</div>

---
Keelson 是一个本地优先的跨平台桌面应用，把散落的 AI-CLI 会话、项目、任务、文档收拢到一处。数据默认留在本机——会话正文不进数据库、AI 检索倾向本地 embedding、正文不发第三方。

## 核心能力

- **会话中枢 + Spotlight** —— 汇聚本地 Claude / Codex 等 CLI 的会话，全文搜索（Tantivy + jieba），全局热键即时唤起，一键恢复终端上下文。
- **项目看板** —— 两层项目模型：有会话的目录自动成轻量项目，可一键「提升」为受管 Board（任务 / 工作流 / 拖拽排序 / 模板），会话与任务双向溯源跳转。
- **文档 / 日历** —— 版本化文档（乐观并发、斜杠命令、KaTeX、文内 AI），支持重复规则与提醒的日历。
- **AI Chat + RAG** —— 可配置多 provider（Anthropic / OpenAI 兼容 / 本地），按用户 token 走 PocketBase 授权的作用域工具，检索历史会话回答「上次怎么解决的 X」。
- **化学反应沉淀** —— 会话 → 候选抽取 → 确认 → 落成文档 / 任务 / 日历，带溯源回链。
- **阅读 · 记忆账本 · MCP Server** —— 收藏外部文章并 AI 摘要（支持登录墙站点粘贴正文）；可审核的记忆账本；对外暴露 MCP 工具供其它 AI 读写工作台数据。
- **Web 远程访问** —— 设备配对 + Tailscale，从手机 / 浏览器安全访问本机工作台的终端 / 会话 / 通知；token 认证、失败限流、默认关闭。
- **进程管理 + 交互式终端** —— 内置 PTY 终端管理长驻进程，支持 sudo 密码交互，日志实时查看 / 复制；常用命令收藏与历史。
- **指令库 · 工作报告 · 命令面板** —— 可复用的 `{{变量}}` 提示词模板、AI 汇总工作报告、⌘K 全局命令面板。
- **双语 + 自动更新** —— 中 / 英 i18n；应用内自动更新（minisign 签名校验），启动即查、每 6 小时静默复查。

## 界面

<div align="center">
  <img src="public/screenshots/board.png" alt="项目看板" width="860" /><br/>
  <sub><b>项目看板</b> —— 待办 / 进行中 / 已完成，任务优先级与截止日，一键「注入到 CLI」</sub>
</div>

<table>
<tr>
<td width="50%"><img src="public/screenshots/dashboard.png" alt="总览" /><br/><sub><b>总览</b> —— 会话 / 看板 / 阅读 / 日程聚合一处</sub></td>
<td width="50%"><img src="public/screenshots/doc-editor.png" alt="文档编辑" /><br/><sub><b>文档</b> —— 斜杠命令 / KaTeX / 文内 AI</sub></td>
</tr>
<tr>
<td><img src="public/screenshots/reading.png" alt="阅读" /><br/><sub><b>阅读</b> —— 收藏 + AI 摘要，按状态归档</sub></td>
<td><img src="public/screenshots/calendar.png" alt="日历" /><br/><sub><b>日历</b> —— 事件 / 重复 / 提醒</sub></td>
</tr>
<tr>
<td><img src="public/screenshots/memory.png" alt="记忆账本" /><br/><sub><b>记忆账本</b> —— 可审核的跨会话记忆</sub></td>
<td><img src="public/screenshots/prompts.png" alt="指令库" /><br/><sub><b>指令库</b> —— {{变量}} 模板，一键插入</sub></td>
</tr>
</table>

## 安装

### 包管理器

| 平台 | 命令 | 状态 |
|---|---|---|
| Windows · winget | `winget install akapril.Keelson` | 发布清单后可用（已备 CI，见 [`packaging/`](packaging/README.md)） |
| Windows · scoop | `scoop bucket add keelson <bucket仓库> && scoop install keelson` | 需建 bucket（骨架见 `packaging/scoop/`） |
| Linux · AUR | `yay -S keelson-bin` | 需发 AUR（骨架见 `packaging/aur/`） |
| macOS · brew | `brew install --cask keelson` | 计划中（需 Apple 公证，暂不可） |

> 上述命令需先把清单发到各自生态，一次性步骤见 [`packaging/README.md`](packaging/README.md)。在此之前用下面的一键脚本或手动下载。

### 一键脚本（现即可用）

**Windows**（PowerShell）：

```powershell
irm https://raw.githubusercontent.com/akapril/keelson/master/install.ps1 | iex
```

**macOS / Linux**：

```bash
curl -fsSL https://raw.githubusercontent.com/akapril/keelson/master/install.sh | sh
```

脚本会自动从 GitHub Releases 取**最新已发布版本**，按平台 / 架构下载并安装。

### 手动下载

到 [Releases](https://github.com/akapril/keelson/releases) 下载对应安装包：

| 平台 | 安装包 | 安装方式 |
|---|---|---|
| **Windows** x64 | `*-setup.exe`（NSIS）或 `*.msi` | 双击运行。SmartScreen 提示“未知发布者”→ 点「更多信息」→「仍要运行」。 |
| **macOS** Apple Silicon | `*_aarch64.dmg` | 打开 dmg，拖 Keelson 进 Applications。首次打开见下方 ⚠️。 |
| **macOS** Intel | `*_x64.dmg` | 同上。 |
| **Linux** x64 | `*.AppImage` | `chmod +x Keelson_*.AppImage && ./Keelson_*.AppImage`（便携，免装）。 |
| **Linux** x64 | `*.deb` | `sudo dpkg -i Keelson_*.deb`（缺依赖时 `sudo apt-get -f install`）。 |

> ⚠️ **macOS 首次打开提示「已损坏 / 无法验证开发者」**：应用为 ad-hoc 签名、未做 Apple 公证。二选一解决：
> - 右键点应用 →「打开」→ 再点「打开」；或 系统设置 → 隐私与安全性 →「仍要打开」。
> - 或终端执行：`xattr -dr com.apple.quarantine /Applications/Keelson.app`
>
> （一键脚本已自动处理这步。）

> 💡 **自动更新**：装好后无需再手动下载——内置应用内自动更新，发现新版一键升级。

## 快速开始

装好、打开 Keelson（本地优先、**免登录**、开箱即用）后：

1. **产生会话**：在任意目录用你平时的 CLI 跑 `claude` / `codex` —— 会话会自动出现在 **会话中枢**（全文可搜、一键恢复上下文）。
2. **提升为项目**：把你常用的目录一键「提升为项目」，它的 **看板 / 文档 / 进程 / AI** 就都挂到这个项目工作台下。
3. **让 AI 直接读写工作台**：把 `claude` / `codex` 接上 Keelson 的 MCP（见下），它就能直接建任务、写文档到你的看板。
4. **随手沉淀**：会话里的结论用「化学反应」抽成 文档 / 任务 / 日历，带溯源回链；外部文章丢进 **阅读** 让 AI 摘要。

> 数据默认全留本机，不登录、不上传（见「隐私边界」）。

## 接入 AI CLI（MCP）

Keelson 内置一个 MCP server，让本地 `claude` / `codex`（及任意 MCP 客户端）直接操作你的**看板任务**与**文档**，授权由 owner-only 规则强制（只能碰你自己的数据）。

**应用内一键接入**：打开 **设置 → MCP 接入（claude / codex）**，点「**接入 Claude Code**」或「**接入 Codex**」——自动写好客户端配置（`~/.claude.json` / `~/.codex/config.toml`），无需手敲命令。

进阶 / 手动配置、可用工具与验证见 [`docs/mcp-setup.md`](docs/mcp-setup.md)。

## 远程使用（Web 端）

在**手机 / 平板 / 另一台电脑**上安全访问本机的 Keelson —— 浏览工作台、看会话与通知，甚至用 **Web 终端**远程驱动 `claude` / `codex`。

- **双层安全**：① Tailscale 私有网（只有你同账号登录的设备可达，公网到不了）② 应用**配对 token**（外部设备需输一次配对码，之后 token 鉴权、失败限流、可随时吊销）。**默认关闭**，需在设置里显式开启。
- **能远程做什么**：Web 终端（跑 CLI）、工作台会话列表、通知 —— 移动优先的响应式界面。
- **接入**：本机与远程设备装 Tailscale（同账号）→ 设置里开「Web 网关」并配对 → 经 `tailscale serve` 的 HTTPS 访问（`Secure` cookie 要求 HTTPS，见文档）。
- ⚠️ 远程终端可在本机执行任意命令 —— 只在**受信设备**上配对；设备丢失即在设置里吊销其 token。

完整接入步骤见 [`docs/web-remote-access.md`](docs/web-remote-access.md)。

## 技术栈

| 层 | 选型 |
|---|---|
| 外壳 | Rust + **Tauri v2** |
| 前端 | React 19 · TypeScript · Tailwind 4 · shadcn/ui · Zustand |
| 数据 | **PocketBase**（sidecar，绑定 127.0.0.1，全表 owner + access-rules 多用户就绪） |
| 搜索 | Tantivy + jieba（本地全文） |
| 远程 | axum 网关 + 设备配对（token）+ Tailscale；portable-pty 终端 |

## 开发

**前置：** Node 20+、pnpm、Rust stable。Linux 另需 `libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev`。

```bash
pnpm install
pnpm tauri dev      # 启动应用（首次会自动下载对应平台的 PocketBase sidecar）
```

常用校验：

```bash
pnpm lint           # eslint
pnpm exec tsc --noEmit
pnpm test           # vitest
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

## 构建

```bash
pnpm tauri build    # 产物在 <target>/release/bundle/
```

PocketBase sidecar 由 `scripts/fetch-pocketbase.mjs` 在 `prebuild` 阶段按当前平台三元组自动获取，并以 Tauri sidecar 命名规则放入 `src-tauri/binaries/`。

发布：推送 `v*` 标签触发 [`release.yml`](.github/workflows/release.yml)，四平台交叉构建并汇总为一个 Release 草稿；人工 Publish 后，旧版本即可通过应用内更新检测到新版。

## 隐私边界

会话正文留在磁盘，仅元数据入 PocketBase；AI 检索倾向本地 embedding，正文不发送第三方；破坏性操作不注册为 AI 工具（服务端 access-rules 即授权边界）。Web 远程访问默认关闭，开启后仅 token 认证的已配对设备可入。

## 常见问题

- **需要注册 / 登录吗？** 不需要。本地模式免登录、开箱即用；登录仅在你主动配置「远程 PocketBase」多设备时才出现。
- **数据会上传吗？** 不会。数据默认全留本机；只有你显式调用 AI provider 时，才把当次所需内容发给你配置的模型。
- **支持哪些 CLI？** 任何把会话落盘的 AI-CLI，目前主打 `claude` / `codex`（自动扫描本地会话）。
- **多机同步？** 规划中（离线优先、单用户 LWW，见 `docs/`）；当前每台机器数据独立。
- **macOS 打不开（“已损坏”）？** 应用未公证，见「安装」章节的 Gatekeeper 绕过（右键打开 / `xattr` / 一键脚本已自动处理）。

## 数据与备份

所有业务数据在本机 PocketBase 的 `pb_data` 目录（设置 → 后端 → 「打开数据目录」可直达）：

| 平台 | 路径 |
|---|---|
| Windows | `%APPDATA%\com.keelson.app\pb_data` |
| macOS | `~/Library/Application Support/com.keelson.app/pb_data` |
| Linux | `~/.local/share/com.keelson.app/pb_data` |

备份 = 关闭 Keelson 后整目录拷走即可（`data.db` 为主库，`storage/` 为文档图片）。会话本身不在此——它们是 `~/.claude` 等的实时扫描，不由 Keelson 存储。

## License

[MIT](LICENSE) © akapril
