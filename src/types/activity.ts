// 实时活动流类型 —— 对应后端 emit("activity", ev) 事件与 PB activities 集合。

/** 来源档：mcp = 进程内 MCP 调用（Phase 1）；hook = Claude Code hook 全量工具（Phase 2）。 */
export type ActivitySource = "mcp" | "hook";

/** 归一动作：write | read | run | search（用于图标/分组）。 */
export type ActivityAction = "write" | "read" | "run" | "search";

/** 结果状态。 */
export type ActivityStatus = "ok" | "error";

/** 单条活动事件（内存流 + 持久历史统一形态）。 */
export interface ActivityEvent {
  /** 前端生成（内存事件）或 PB id（持久事件）。 */
  id: string;
  /** ISO 时间。 */
  ts: string;
  source: ActivitySource;
  /** "claude" | "codex" | ""（MCP 侧未必可知则空）。 */
  provider: string;
  /** 原始工具名：create_task / Edit / Bash / search_memory ... */
  tool: string;
  /** 归一动作，用于图标/分组。 */
  action: ActivityAction;
  /** 一行人类可读摘要。 */
  summary: string;
  /** 关联 board 项目 id（有则可路由到该项目「活动」tab）。 */
  project_id?: string;
  /** hook 侧 cwd；用于 repo→project 路由（Phase 2）。 */
  repo_path?: string;
  session_id?: string;
  status: ActivityStatus;
}
