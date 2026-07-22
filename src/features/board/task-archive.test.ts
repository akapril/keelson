import { describe, it, expect } from "vitest";
import { tasksToAutoArchive, archivableInState } from "./task-archive";
import type { BoardTask, BoardState } from "@/types/board";

const NOW = Date.parse("2026-07-22T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const states: BoardState[] = [
  { id: "s1", project: "p", name: "待办", color: "#000", category: "pending", sort_order: 0, created: "", updated: "" },
  { id: "s2", project: "p", name: "进行", color: "#000", category: "active", sort_order: 1, created: "", updated: "" },
  { id: "s3", project: "p", name: "完成", color: "#000", category: "completed", sort_order: 2, created: "", updated: "" },
];

function task(id: string, state: string, updated: string, archived = false): BoardTask {
  return {
    id, project: "p", state, title: id, priority: "none",
    archived, created_by: "u", created: updated, updated,
  };
}

describe("tasksToAutoArchive", () => {
  it("归档：完成列且更新超过阈值", () => {
    const tasks = [
      task("old", "s3", daysAgo(10)),   // 完成 10 天前 → 归档
      task("fresh", "s3", daysAgo(2)),  // 完成 2 天前 → 不归档
      task("active", "s2", daysAgo(30)),// 非完成列 → 不归档
    ];
    expect(tasksToAutoArchive(tasks, states, 7, NOW)).toEqual(["old"]);
  });

  it("已归档的不再计入", () => {
    const tasks = [task("done", "s3", daysAgo(10), true)];
    expect(tasksToAutoArchive(tasks, states, 7, NOW)).toEqual([]);
  });

  it("阈值<=0 关闭自动归档", () => {
    const tasks = [task("old", "s3", daysAgo(100))];
    expect(tasksToAutoArchive(tasks, states, 0, NOW)).toEqual([]);
  });

  it("边界：恰好等于阈值不归档（需严格超过）", () => {
    const tasks = [task("edge", "s3", daysAgo(7))];
    // 7 天前 == cutoff，非严格小于 → 不归档
    expect(tasksToAutoArchive(tasks, states, 7, NOW)).toEqual([]);
  });
});

describe("archivableInState", () => {
  it("只取该列未归档任务", () => {
    const tasks = [
      task("a", "s3", daysAgo(1)),
      task("b", "s3", daysAgo(1), true),
      task("c", "s2", daysAgo(1)),
    ];
    expect(archivableInState(tasks, "s3")).toEqual(["a"]);
  });
});
