# rework 的三套记忆系统

rework 运行环境里同时存在**三套彼此独立**的"记忆"，容易混淆。本文说明各自职责、数据落点与关系，避免误以为它们互通。

## 一览

| 系统 | 归属 | 数据落点 | 作用范围 | 谁读写 |
|---|---|---|---|---|
| **Claude 文件记忆** | Claude Code（本机 CLI） | `~/.claude/projects/<proj>/memory/*.md` + `MEMORY.md` 索引 | 仅 Claude Code 会话上下文 | Claude 自己按需读写 |
| **claude-mem 插件** | claude-mem 第三方插件 | 插件自己的 memory DB（跨会话检索） | 仅该插件的检索工具 | 插件在会话间自动沉淀/检索 |
| **rework 记忆账本** | rework 产品自身 | PocketBase `memories` 集合（owner-only） | rework 产品内（记忆页 / MCP / 收件箱） | 用户 + MCP `create_memory` + 会话抽取 |

## 三者关系（重点）

- **三套不自动互通**：Claude 文件记忆、claude-mem、rework 账本各存各的。在 rework「记忆」页 / MCP `search_memory` 里**只查得到账本**，查不到另外两套。
- **唯一"产品内"记忆 = rework 账本**：只有账本是 rework 自己拥有、可在 UI 展示/审核/采纳的记忆。另外两套是 Claude 侧的黑盒，rework 不托管。
- **已有的桥接**：`import-file-memories` 可把 Claude 文件记忆（`memory/*.md`）**单向导入**账本（需手动触发）。claude-mem 与账本**无任何互通**。
- **写账本的入口**：
  1. 用户在「记忆」页手动建；
  2. 会话「化学反应」抽取候选记忆；
  3. MCP 工具 `create_memory`（默认落"待审"，经收件箱采纳后生效）。

## 使用建议

- 想让某条知识在 **rework 产品内**长期可见/可搜 → 写进**账本**（记忆页或 MCP `create_memory`）。
- Claude 文件记忆是 **Claude Code 会话专用**，改它只影响 CLI 上下文，不进 rework。
- claude-mem 是插件自治，rework 不依赖也不读取它。

## 待办（backlog）

- claude-mem → 账本 的同步或统一查询 facade（目前孤立）。
- 文件记忆导入自动化（目前需手动触发 `import-file-memories`）。
- 记忆审核 UI 区分三套来源的可靠性差异。
