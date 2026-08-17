// agent_runs 访问层（读列表；写由 Tauri 命令侧完成）。
import { pb } from "../pb";
import { NOT_DELETED, combineFilters } from "./collections";
import type { AgentRun } from "../../types/agent";

const COLL = "agent_runs";

/** 某任务的运行记录（最新在前）。 */
export function listAgentRuns(taskId: string): Promise<AgentRun[]> {
  return pb.collection(COLL).getFullList<AgentRun>({
    requestKey: null,
    filter: combineFilters(NOT_DELETED, `task = "${taskId.replace(/"/g, "")}"`),
    sort: "-started",
  });
}

/** 跨项目待决策运行（review/blocked，未软删，最新在前）。owner 范围由访问规则保证。 */
export function listPendingAgentRuns(): Promise<AgentRun[]> {
  return pb.collection(COLL).getFullList<AgentRun>({
    requestKey: null,
    filter: combineFilters(NOT_DELETED, `(status = "review" || status = "blocked")`),
    sort: "-started",
  });
}
