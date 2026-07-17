---
name: rework-board
description: Use when the user wants to manage their rework kanban board or docs from claude — creating/updating tasks, creating/updating docs, or querying their projects. Requires the rework app running and its MCP server connected (see docs/mcp-setup.md).
---

# 操作 rework 看板与文档

用户的看板任务与文档在 **rework** 应用里。你可以通过 rework MCP server 的工具读写它们。

## 工作方式

- rework 无"当前项目"概念——**建/查任务或文档前，必须先 `list_projects` 拿到 `project_id`**，再 `list_states` 拿状态列 id。**不要臆造 id。**
- 建任务：`create_task(project_id, state_id, title, [description, priority, due_date])`。priority ∈ none/low/medium/high/urgent；due_date 形如 `2026-08-01`。任务追加到目标列末尾。
- 改任务：`update_task(task_id, {只传要改的字段})`；`state_id` 用于移动到别的列。
- 文档同理：`list_docs` / `create_doc(project_id, title, [content])` / `update_doc(doc_id, {...})`。content 是 Markdown。
- **无删除工具**——不要尝试删除。

## 规矩

1. 拿不准项目/列/任务的 id 时，先 `list_*` 查，别猜。
2. 一次建多个任务：先 `list_states` 一次，再连续 `create_task`。
3. 操作完成后，用简洁中文说明你做了什么（建了哪些任务、放到哪个项目哪个列）。
4. 报错时如实转述（如「rework 未就绪」通常是应用没开或还在初始化）。

## 典型场景

- "把这次讨论拆成任务放进 X 项目" → `list_projects`→定位 X→`list_states`→选目标列→逐个 `create_task`。
- "我的 rework 里有哪些待办" → `list_projects`→对相关项目 `list_tasks`→归纳。
- "把这段整理成一篇文档放到 X" → `list_projects`→`create_doc`。
