# rework 路线图

> codename **rework** = retalk（本地 AI-CLI 会话管理）+ workavera（AI 工作空间）融合。
> 栈：Rust + Tauri v2 + React19/TS/Tailwind4/shadcn + PocketBase(sidecar, 127.0.0.1)。单用户先行、全表 owner+access-rules 多用户就绪。
> **借鉴设计不抄码**。workavera 参考基准 = `D:/workspace/workavera`（全量源码，Go）。

| 阶段 | 内容 | 状态 | workavera 参考 |
|---|---|---|---|
| **0 地基** | Tauri+React+PB sidecar + 免登录 bootstrap + 迁移 + 双网关 + 中性主题 | ✅ 完成 | — |
| **① 会话中枢 + Spotlight** | provider 四职责 trait+registry（零 match）· Tantivy+jieba 搜索 · 终端恢复 · 会话元数据→PB 同步 · 全局热键弹窗 · 设置 | ✅ 完成 | — |
| **② 工作台数据层** | Docs（版本/乐观并发）· Board（看板/工作流/任务/rank/模板）· Calendar（重复规则/时区/提醒） | ⏳ 未开始（MVP 北极星已设计） | `internal/{docs,board,calendar}` + `migrations/` |
| **③ AI Chat + 工具** | 可配置多 provider（Anthropic/OpenAI兼容/本地）· actor 作用域工具（用户 token→PB rules 授权，无 delete 工具）· 多步 agent loop · 流式经 Tauri channel · chat 持久化+断线重连 | 🚧 **进行中**（先做切片 **③-1 问历史会话 Chat+RAG**） | `internal/{agent,assistant/tools,chat,llm}`、`frontend/src/components/chat`、`lib/chat-runtime.ts` |
| **③-1** | Chat + 会话 RAG（本地 embedding，正文不出本机）："上次怎么解决的 X"检索历史会话回答+跳转 | 🚧 spec 待写（等 rig-core 选型 spike） | 同上 |
| **④ 化学反应** | 会话→沉淀闭环（extract 出候选→确认→写 Docs/Board/Calendar，带溯源回链）+ 主动提议引擎 + 通知 | ⏳ 设计已存档 | `internal/{reading,notifications}`（摘要范式 + 调度器）；设计见 `specs/2026-07-15-rework-chemistry-ops-design.md` |
| **⑤ 多用户** | 创建/切换/登录 + 用户管理 + 关掉免登录（基础已 owner+access-rules 就绪） | ⏳ 已列入（用户明确想要） | `internal/contacts`（用户目录 + AI 安全投影） |
| **⑥ Reading 阅读/收藏** | 存外部 URL/文章 + AI 摘要 + 关键点抽取（抓取→摘要范式复用到会话沉淀） | ⏳ 已纳入（2026-07-15 用户选定） | `internal/reading/` |
| **⑦ AI Micro Apps** | AI 现场生成可交互 HTML 小工具（FileField 存储 + CSP/iframe 沙箱 + 大文件分块写） | ⏳ 已纳入（2026-07-15 用户选定，偏后期） | `internal/microapps/` |
| （暂缓） | Dashboard 首页总览（等数据多了再做）；Configs 折进设置页 | 暂缓 | `frontend` dashboard、`internal/configs` |

## 设计原则（贯穿全程）
- KISS / YAGNI / SOLID。每阶段：brainstorm→spec→plan→subagent 双审（spec+quality）+ 关键 IO 路径**对 live PB 实测**（MVP 阶段实测揪出 4 个绿测试漏掉的运行时 bug）。
- 权限：AI 工具持用户 PB token → PB access rules 即服务端授权；破坏性操作不注册工具。
- 主题：中性明暗双主题（**非莫兰迪**，用户对本项目的显式覆盖），全走 CSS 变量。
- 隐私：会话正文留磁盘不进 PB；RAG 倾向本地 embedding，正文不发第三方。

## 已完成里程碑
- **MVP（Phase 0+①）**：branch `feat/mvp-phase-0-1`，cargo 49 + vitest 17 全绿，含 5 个实测修复。收尾决定（merge/keep/PR）仍挂起。
