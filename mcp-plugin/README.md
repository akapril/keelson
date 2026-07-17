# rework —— Claude Code plugin

让 claude 操作你的 rework 看板任务与文档。包含：

- **skill `rework-board`**：引导 claude 正确使用 rework 的 MCP 工具（先 `list_projects` 拿 id、无删除等）。
- **命令 `/rework-triage`**：把当前对话里的待办归纳成看板任务。

## MCP 连接不在本 plugin 里

rework 的 MCP server 由 **rework 应用本身**内置提供，端点 url + secret **每次启动可能变**（写在应用数据目录的 `mcp-endpoint.json`）。因此本 plugin **不打包 `.mcp.json`**——请按 [`docs/mcp-setup.md`](../docs/mcp-setup.md) 用 `claude mcp add`（或 Windows 一键 PowerShell 片段）连接。skill 与命令在连接就绪后自动生效。

## 安装

把本目录作为 Claude Code plugin 加载（参考你所用 Claude Code 版本的 plugin 安装方式），再按 `docs/mcp-setup.md` 配好 MCP 连接。

> 前提：rework 应用开着（PocketBase 是其 sidecar，MCP server 随应用启动）。
