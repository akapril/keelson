# 实时活动流 · 设计（Live Activity Stream）

> 让「安装了 rework MCP / 插件的 claude / codex 会话」在使用时，把**对项目进行的操作实时呈现在 rework 主界面**——从「事后浏览会话」升级为「实时看 agent 在做什么」。

**Goal:** 外部 CLI（claude/codex）执行时，其对项目的操作（建/改任务文档、搜记忆、改文件、跑命令）实时出现在 rework：① 顶栏全局实时指示 ② 项目工作台「活动」tab（按 repo 过滤）。

**Architecture:** rework 已在 `127.0.0.1:47600` 跑进程内 rmcp+axum 服务，MCP 工具调用就在 app 进程内、手握 `AppHandle`。统一「活动事件总线」= 后端 `app.emit("activity", ev)` → 前端 `useActivityStore`（zustand 环形缓冲）实时渲染。两个信号档：档 1 进程内 MCP 调用（Phase 1），档 2 Claude Code hook 全量工具（Phase 2）。

**Tech Stack:** Rust/Tauri v2（emit + axum 路由 + PB 写）、React 19/TS zustand、PocketBase migration。

## 已决策取舍
1. **保真度**：两档都要——档 1（MCP 活动，Phase 1）先，档 2（hook 全量，Phase 2）后。
2. **展示**：两处都要——顶栏全局实时指示 + 项目工作台「活动」tab。
3. **存储**：混合——**实时全进内存**（环形缓冲，重启即清）；**只把「写操作」落 PB**（可回放历史），读操作只实时不存。

## 事件模型
```ts
// src/types/activity.ts
export type ActivitySource = "mcp" | "hook";
export interface ActivityEvent {
  id: string;            // 前端生成（内存事件）或 PB id（持久事件）
  ts: string;            // ISO 时间
  source: ActivitySource;
  provider: string;      // "claude" | "codex" | ""（MCP 侧未必可知则空）
  tool: string;          // create_task / Edit / Bash / search_memory ...
  action: string;        // 归一动作：write | read | run | search（用于图标/分组）
  summary: string;       // 一行人类可读：如「新建任务：修复登录」「Edit src/app.ts」
  project_id?: string;   // 关联 board 项目（有则路由到该项目 tab）
  repo_path?: string;    // hook 侧 cwd；用于 repo→project 路由
  session_id?: string;
  status: "ok" | "error";
}
```
**写操作判定**（决定是否落 PB）：`is_write` = MCP `create_task|update_task|create_doc|update_doc`；Hook `Edit|Write|MultiEdit|NotebookEdit|Bash`。其余（list_*/search_memory/Read/Grep/Glob…）只实时不存。

## Phase 1 — 档 1：MCP 活动流 + 两处展示 + 混合存储

### Rust（`src-tauri/src/mcp/server.rs`）
在 `call_tool` 里，无论读写、成功失败，都发一条活动事件（现仅 create_task/doc 推通知，保留通知不动）：
- 纯函数 `activity_summary(tool, &args, &result) -> (action, summary)`（可测；如 create_task→("write","新建任务：{title}")，list_tasks→("read","查询任务")，search_memory→("search","检索记忆：{query}")）。
- 组装 `ActivityEvent`（source="mcp"，project_id 取 args.project_id，status 依 Ok/Err），`app.emit("activity", ev)`。
- 若 `is_write_tool(tool)`：额外 `ctx.client.create("activities", {...})` 落 PB（失败静默，不影响工具结果）。

### PB 迁移（`src-tauri/pb_migrations/1720001000_activities.js`）
`activities` 集合（owner-only）：owner(relation)、source(text)、provider(text)、tool(text)、action(text)、summary(text max:0? 否——短，max 1000)、project(text 200)、repo_path(text 500)、session_id(text 200)、status(text 20)、created(autodate)。索引 owner+created、owner+project。仅 listRule/viewRule/createRule/deleteRule owner-only（**沿用 memories 迁移的规则写法**，不用 `@request.body.X:changed`）。

### 前端
- `src/store/activity.ts`：`useActivityStore`——`events: ActivityEvent[]`（`push` 保留最近 200，头部插入）、`pulse` 时间戳（触发顶栏脉冲）、`clear()`。app 根 `listen<ActivityEvent>("activity", …)` 一次（放 `App.tsx` 或现有事件订阅处）。
- `src/lib/pb/activity.ts`：`listActivities(projectId?)`（按 owner，可选 project 过滤，`-created`，limit 100）——供项目 tab 加载持久历史。
- 顶栏全局指示 `src/components/activity-indicator.tsx`：仿 `notification-bell`——有新活动脉冲；下拉显示内存流最近 N 条（点跳对应项目）。挂到 `dashboard-layout` 顶栏（通知铃旁）。
- 项目工作台「活动」tab：`src/features/board/WorkspaceActivity.tsx`——挂载时 `listActivities(project.id)` 拉持久历史，叠加内存流里 `project_id===project.id` 的实时事件（合并去重、按 ts 倒序）。`ProjectWorkspace.tsx` 加 `<TabsTrigger value="activity">活动</TabsTrigger>` + content。

## Phase 2 — 档 2：Claude Code hook 全量工具流
> Phase 1 完成、可独立运行后再做。

### Rust
- `server.rs` axum router 加 `POST /activity`（同 Bearer secret 中间件）：body = hook payload（tool、cwd、summary、status），转 `ActivityEvent`（source="hook"），`app.emit("activity", …)` + 写操作落 PB。`cwd → repo_path`；前端按 repo_path 匹配 `board_projects.repo_path` 路由。
- `commands/hooks.rs`（新）：`install_activity_hook()` / `uninstall_activity_hook()` / `activity_hook_status()`——写 `~/.claude/settings.json` 的 `hooks.PostToolUse`（受管、幂等、与用户既有 hooks 共存），命令行调用 rework 附带的小 helper 把事件 POST 到端点。
- **Windows helper**：Claude Code hook 跑命令，Windows 无保证的 curl → 附带一个极小的 POST helper（PowerShell 脚本 或 复用 rework 自身 `--hook-post` 子命令读 stdin 转发）。Phase 2 细化选型。

### 前端
- 设置页或项目工作台加「实时活动 hook」启用条（仿溯源 `HookBar`）：装/卸/状态。
- codex 说明：档 2 无逐工具 hook，codex 仅档 1（MCP）+ 可能回合级 notify，UI 注明。

## 测试
- Phase 1 Rust：`activity_summary`（各工具→动作/摘要）、`is_write_tool`（写/读分类）。
- Phase 1 前端 vitest：activity store `push` 环形截断 + 项目过滤合并去重。
- Phase 2：`/activity` payload→事件映射、hook settings.json 受管块幂等（仿 git 钩子测试）。

## 约束
- 注释/日志中文；中性主题不硬编码颜色。
- 活动 emit / PB 落盘失败一律静默，**绝不影响 MCP 工具结果或阻断 agent**。
- 内存流上限 200，避免长会话内存膨胀。
- PB `activities` 只存写操作，控制写入量；沿用 memories 迁移的 owner-only 规则写法。
- 受管块（Phase 2 hook）只动 rework 标记区间，用户既有 settings.json 内容零改动。
