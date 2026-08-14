// agent_runs 记录类型（对齐 PB agent_runs 集合）。
export type AgentRunStatus = "running" | "review" | "blocked" | "merged" | "discarded";
export interface AgentRun {
  id: string;
  task: string;
  project: string;
  provider: string;
  status: AgentRunStatus;
  branch: string;
  worktree_path: string;
  exit_code?: number;
  blocker: string;
  no_change: boolean;
  diff_stat: string;
  log_tail: string;
  started: string;
  ended: string;
}
