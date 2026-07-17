# 把 rework 接入 claude / codex（MCP）

rework 应用内置了一个 MCP server，让本地 `claude` / `codex`（及任意 MCP 客户端）直接操作你的**看板任务**与**文档**。工具执行走 rework 的 PocketBase，授权由 owner-only 访问规则强制——只能碰你自己的数据。

## 前提

- **rework 应用必须开着**（PocketBase 是它的 sidecar，MCP server 在应用启动、账户就绪后拉起）。
- 启动后控制台会打印一行 `[mcp] MCP server 就绪：http://127.0.0.1:47600/mcp`。

## 1. 找到端点 url + secret

应用启动时会写一个端点文件（端口默认 47600，被占用会回退；secret 每次启动随机生成）：

| 平台 | 端点文件路径 |
|---|---|
| Windows | `%APPDATA%\com.rework.app\mcp-endpoint.json` |
| macOS | `~/Library/Application Support/com.rework.app/mcp-endpoint.json` |
| Linux | `~/.local/share/com.rework.app/mcp-endpoint.json` |

内容形如：

```json
{ "url": "http://127.0.0.1:47600/mcp", "secret": "3f9a…（32 位十六进制）" }
```

> ⚠️ **secret 每次启动会变**（v1 未持久化）。重启 rework 后需重新配置一次客户端（见下）。

## 2. Claude Code 接入

用端点文件里的 `url` 与 `secret`：

```bash
claude mcp add --transport http rework "<url>" \
  --header "Authorization: Bearer <secret>"
```

或写进项目 `.mcp.json`：

```json
{
  "mcpServers": {
    "rework": {
      "type": "http",
      "url": "http://127.0.0.1:47600/mcp",
      "headers": { "Authorization": "Bearer <secret>" }
    }
  }
}
```

**Windows 一键读文件并配置（PowerShell）：**

```powershell
$e = Get-Content "$env:APPDATA\com.rework.app\mcp-endpoint.json" | ConvertFrom-Json
claude mcp add --transport http rework $e.url --header "Authorization: Bearer $($e.secret)"
```

## 3. Codex 接入

`~/.codex/config.toml`：

```toml
[mcp_servers.rework]
url = "http://127.0.0.1:47600/mcp"
http_headers = { "Authorization" = "Bearer <secret>" }
```

## 4. 可用工具（v1）

| 工具 | 作用 |
|---|---|
| `list_projects` | 列出所有看板项目（先用它拿 project_id） |
| `list_states` | 列出某项目的状态列 |
| `list_tasks` | 列出某项目的任务 |
| `create_task` | 在某项目某状态列建任务（追加到末尾） |
| `update_task` | 改任务字段（标题/描述/优先级/状态列/截止日） |
| `list_docs` | 列出某项目的文档 |
| `create_doc` | 建文档（Markdown 正文可选） |
| `update_doc` | 改文档标题/正文 |

无删除工具（安全）。

## 5. 验证

在 claude 里说：「列出我的 rework 项目，然后在第一个项目的第一个状态列建一个任务『测试 MCP』」。
应看到它依次调用 `list_projects` → `list_states` → `create_task`，且**任务实时出现在 rework 应用的看板里**（PocketBase 实时同步）。

裸 HTTP 冒烟（确认 server + 鉴权）：

```bash
# 正常：返回 8 个工具
curl -s <url> -H "Authorization: Bearer <secret>" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# 无 Bearer / secret 错误：应 401
```

## 已知限制（v1）

- secret 每次启动变（未持久化）——重启需重配客户端。**改进项**:后续用 keychain 持久化 secret（复用 `bootstrap.rs` 的 `get_or_make_secret`），即可一次配置长期有效。
- 端口 47600 被占用时回退随机端口（以端点文件为准）。
- 仅本机（127.0.0.1）；应用退出后端点不可用。
- 工具集限看板+文档；RAG/会话检索等 Rust-only 能力后续可加（注册表登记一行）。
