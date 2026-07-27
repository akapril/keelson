<div align="center">
  <img src="public/keelson.svg" width="72" height="72" alt="Keelson" />
  <h1>Keelson</h1>
  <p><b>本地优先的 AI 工作台</b> —— 把散落的 AI-CLI 会话、项目、任务、文档收拢到一处。</p>
  <p><sub>简体中文 · <a href="README.en.md">English</a></sub></p>
</div>

---

Keelson 是一个本地优先的跨平台桌面应用，把散落的 AI-CLI 会话、项目、任务、文档收拢到一处。数据默认留在本机——会话正文不进数据库、AI 检索倾向本地 embedding、正文不发第三方。

## 核心能力

- **会话中枢 + Spotlight** —— 汇聚本地 Claude / Codex 等 CLI 的会话，全文搜索（Tantivy + jieba），全局热键即时唤起，一键恢复终端上下文。
- **项目看板** —— 两层项目模型：有会话的目录自动成轻量项目，可一键「提升」为受管 Board（任务 / 工作流 / 拖拽排序 / 模板），会话与任务双向溯源跳转。
- **文档 / 日历** —— 版本化文档（乐观并发）、支持重复规则与提醒的日历。
- **AI Chat + RAG** —— 可配置多 provider（Anthropic / OpenAI 兼容 / 本地），按用户 token 走 PocketBase 授权的作用域工具，检索历史会话回答「上次怎么解决的 X」。
- **化学反应沉淀** —— 会话 → 候选抽取 → 确认 → 落成文档 / 任务 / 日历，带溯源回链。
- **阅读 · 记忆账本 · MCP Server** —— 收藏外部文章并 AI 摘要；可审核的记忆账本；对外暴露 MCP 工具供其它 AI 读写工作台数据。

## 技术栈

| 层 | 选型 |
|---|---|
| 外壳 | Rust + **Tauri v2** |
| 前端 | React 19 · TypeScript · Tailwind 4 · shadcn/ui · Zustand |
| 数据 | **PocketBase**（sidecar，绑定 127.0.0.1，全表 owner + access-rules 多用户就绪） |
| 搜索 | Tantivy + jieba（本地全文） |

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
pnpm tauri build    # 产物在 src-tauri/target/release/bundle/
```

PocketBase sidecar 由 `scripts/fetch-pocketbase.mjs` 在 `prebuild` 阶段按当前平台三元组自动获取，并以 Tauri sidecar 命名规则放入 `src-tauri/binaries/`。

## 隐私边界

会话正文留在磁盘，仅元数据入 PocketBase；AI 检索倾向本地 embedding，正文不发送第三方；破坏性操作不注册为 AI 工具（服务端 access-rules 即授权边界）。
