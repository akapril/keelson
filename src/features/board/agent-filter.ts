// 看板「有 agent 参与」判定（纯函数，可测）+ S1 支持的 provider 集合。
import type { BoardTask } from "@/types/board";
import type { AgentRun } from "@/types/agent";

// S1 阶段支持 Agent 自主执行的 provider 集合（TaskCard 下拉与看板过滤共用）。
export const AGENT_FILTER_PROVIDERS = new Set(["claude", "codex"]);

// 非终态 run 状态：这些状态说明 agent 仍在参与该任务（执行中/待审/受阻）。
const ACTIVE_RUN_STATUS = new Set(["running", "review", "blocked"]);

/**
 * 判断任务是否「有 agent 参与」：
 * - 有负责人（agent_provider 非空），或
 * - 已入队（agent_enqueued），或
 * - 最新 run 处于非终态（running/review/blocked）。
 * 仅有终态 run（merged/discarded）且无负责人/未入队 → 视为不再参与。
 */
export function taskHasAgent(task: BoardTask, latestRun: AgentRun | null): boolean {
  if (task.agent_provider && task.agent_provider.trim() !== "") return true;
  if (task.agent_enqueued) return true;
  if (latestRun && ACTIVE_RUN_STATUS.has(latestRun.status)) return true;
  return false;
}
