import { describe, it, expect } from "vitest";
import { pendingRunSummary } from "./agent-todo";
import type { AgentRun } from "@/types/agent";

function mkRun(patch: Partial<AgentRun>): AgentRun {
  return {
    id: "r1", task: "t1", project: "p1", provider: "claude", status: "review",
    branch: "", worktree_path: "", blocker: "", no_change: false, diff_stat: "",
    log_tail: "", started: "", ended: "", ...patch,
  };
}

describe("pendingRunSummary", () => {
  it("review 有改动 → 显 diff_stat", () => {
    expect(pendingRunSummary(mkRun({ status: "review", diff_stat: "3 个文件改动" }))).toBe("3 个文件改动");
  });
  it("review 无改动 → 显「无改动」", () => {
    expect(pendingRunSummary(mkRun({ status: "review", diff_stat: "", no_change: true }))).toBe("无改动");
  });
  it("blocked → 显 blocker", () => {
    expect(pendingRunSummary(mkRun({ status: "blocked", blocker: "超时已终止" }))).toBe("超时已终止");
  });
});
