// Agent 待办行的纯函数（可测）：从 run 提取一行摘要。
import type { AgentRun } from "@/types/agent";

/** 待办行摘要：review→diff 概要(空则"无改动")；blocked/其它→blocker。 */
export function pendingRunSummary(run: AgentRun): string {
  if (run.status === "review") {
    return run.diff_stat?.trim() ? run.diff_stat : "无改动";
  }
  return run.blocker?.trim() ? run.blocker : "";
}
