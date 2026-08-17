import { describe, it, expect } from "vitest";
import { taskHasAgent } from "./agent-filter";
import type { BoardTask } from "@/types/board";
import type { AgentRun } from "@/types/agent";

// 构造最小 BoardTask（只填 taskHasAgent 关心的字段，其余用占位）
function mkTask(patch: Partial<BoardTask>): BoardTask {
  return {
    id: "t1",
    project: "p1",
    state: "s1",
    title: "任务",
    priority: "none",
    created_by: "u1",
    created: "",
    updated: "",
    ...patch,
  };
}

// 构造最小 AgentRun
function mkRun(status: AgentRun["status"]): AgentRun {
  return {
    id: "r1",
    task: "t1",
    project: "p1",
    provider: "claude",
    status,
    branch: "",
    worktree_path: "",
    blocker: "",
    no_change: false,
    diff_stat: "",
    log_tail: "",
    started: "",
    ended: "",
  };
}

describe("taskHasAgent", () => {
  it("无负责人、未入队、无 run → false", () => {
    expect(taskHasAgent(mkTask({}), null)).toBe(false);
  });

  it("有负责人（agent_provider 非空）→ true", () => {
    expect(taskHasAgent(mkTask({ agent_provider: "claude" }), null)).toBe(true);
  });

  it("已入队（agent_enqueued）→ true", () => {
    expect(taskHasAgent(mkTask({ agent_enqueued: true }), null)).toBe(true);
  });

  it("有 running run → true", () => {
    expect(taskHasAgent(mkTask({}), mkRun("running"))).toBe(true);
  });

  it("有 blocked run → true", () => {
    expect(taskHasAgent(mkTask({}), mkRun("blocked"))).toBe(true);
  });

  it("仅有终态 run（merged）且无负责人/未入队 → false", () => {
    expect(taskHasAgent(mkTask({}), mkRun("merged"))).toBe(false);
  });

  it("空字符串负责人不算有 agent → false", () => {
    expect(taskHasAgent(mkTask({ agent_provider: "" }), null)).toBe(false);
  });
});
