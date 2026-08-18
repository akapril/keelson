import { describe, it, expect } from "vitest";
import { groupBySwimlane } from "./swimlane";
import type { BoardTask } from "@/types/board";

const mk = (id: string, over: Partial<BoardTask> = {}): BoardTask =>
  ({ id, project: "p", state: "s", title: id, priority: "none", created_by: "u", created: "", updated: "", ...over }) as BoardTask;

const ctx = { labelName: (id: string) => `L:${id}`, agentName: (t: BoardTask) => t.agent_provider || "无 agent" };

describe("groupBySwimlane（泳道分组）", () => {
  it("none → 单带含全部", () => {
    const lanes = groupBySwimlane([mk("a"), mk("b")], "none", ctx);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].taskIds).toEqual(["a", "b"]);
  });

  it("priority → 按 PRIORITY_ORDER 出带，none 归无带排最后", () => {
    const lanes = groupBySwimlane([mk("a", { priority: "high" }), mk("b", { priority: "none" }), mk("c", { priority: "urgent" })], "priority", ctx);
    // 顺序：urgent 带在 high 带前（依 PRIORITY_ORDER），无带最后
    const ids = lanes.map((l) => l.laneId);
    expect(ids[ids.length - 1]).toBe("__none__");
    expect(lanes.find((l) => l.laneId === "__none__")!.taskIds).toEqual(["b"]);
  });

  it("label（多值）→ 任务进每个匹配带，无标签归无带", () => {
    const lanes = groupBySwimlane([mk("a", { labels: ["l1", "l2"] }), mk("b", { labels: [] })], "label", ctx);
    const l1 = lanes.find((l) => l.laneId === "l1")!;
    const l2 = lanes.find((l) => l.laneId === "l2")!;
    expect(l1.taskIds).toContain("a");
    expect(l2.taskIds).toContain("a"); // 同一任务在两带都出现
    expect(lanes.find((l) => l.laneId === "__none__")!.taskIds).toEqual(["b"]);
  });

  it("assignee（多值）同 label 语义", () => {
    const lanes = groupBySwimlane([mk("a", { assignees: ["u1"] }), mk("b", {})], "assignee", ctx);
    expect(lanes.find((l) => l.laneId === "u1")!.taskIds).toContain("a");
    expect(lanes.find((l) => l.laneId === "__none__")!.taskIds).toContain("b");
  });
});
