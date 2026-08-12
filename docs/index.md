---
layout: home

hero:
  name: Keelson
  text: 本地优先的 AI 工作台
  tagline: 把散落的 AI-CLI 会话、项目、任务、文档收拢到一处。数据默认留在本机。
  actions:
    - theme: brand
      text: 开始使用
      link: /mcp-setup
    - theme: alt
      text: 下载
      link: https://github.com/akapril/keelson/releases
    - theme: alt
      text: GitHub
      link: https://github.com/akapril/keelson

features:
  - icon: 🔭
    title: 会话中枢 + Spotlight
    details: 汇聚本地 Claude / Codex 等 CLI 的会话，全文搜索（Tantivy + jieba），全局热键即时唤起，一键恢复终端上下文。
  - icon: 📋
    title: 项目看板
    details: 有会话的目录自动成轻量项目，可一键「提升」为受管 Board（任务 / 工作流 / 拖拽排序 / 模板），会话与任务双向溯源。
  - icon: 📄
    title: 文档 / 日历
    details: 版本化文档（乐观并发、斜杠命令、KaTeX、文内 AI），支持重复规则与提醒的日历。
  - icon: 🧠
    title: AI Chat + RAG
    details: 可配置多 provider（Anthropic / OpenAI 兼容 / 本地），检索历史会话回答「上次怎么解决的 X」。
  - icon: 📱
    title: Web 远程访问
    details: 设备配对 + 隧道，从手机 / 浏览器安全访问本机工作台的终端 / 会话 / 通知；token 认证、失败限流、默认关闭。
  - icon: 🔌
    title: MCP 接入
    details: 内置 MCP server，让本地 claude / codex 直接读写你的看板任务与文档，owner-only 访问规则强制边界。
---
