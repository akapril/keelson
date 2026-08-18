import { describe, it, expect } from "vitest";
import { bucketByDue, bucketStartMs } from "./timeline-bucket";
import type { BoardTask } from "@/types/board";

const mk = (id: string, due?: string): BoardTask =>
  ({ id, project: "p", state: "s", title: id, priority: "none", due_date: due }) as BoardTask;

// 固定基准：2026-08-18 是周二
const NOW = Date.parse("2026-08-18T00:00:00Z");

describe("bucketByDue（截止日归桶）", () => {
  it("无 due 的入 unscheduled", () => {
    const { buckets, unscheduled } = bucketByDue([mk("a"), mk("b", "2026-08-20")], "week", NOW);
    expect(unscheduled.map((t) => t.id)).toEqual(["a"]);
    expect(buckets.flatMap((b) => b.tasks.map((t) => t.id))).toContain("b");
  });

  it("同周任务归同桶", () => {
    const { buckets } = bucketByDue([mk("a", "2026-08-18"), mk("b", "2026-08-20")], "week", NOW);
    const withTasks = buckets.filter((bk) => bk.tasks.length > 0);
    expect(withTasks).toHaveLength(1);
    expect(withTasks[0].tasks.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("跨周分桶且按 startMs 升序", () => {
    const { buckets } = bucketByDue([mk("late", "2026-08-27"), mk("early", "2026-08-18")], "week", NOW);
    const withTasks = buckets.filter((bk) => bk.tasks.length > 0);
    expect(withTasks).toHaveLength(2);
    expect(withTasks[0].startMs).toBeLessThan(withTasks[1].startMs);
    expect(withTasks[0].tasks[0].id).toBe("early");
  });

  it("bucketStartMs：周桶落到周一 0 点", () => {
    const wed = Date.parse("2026-08-19T15:00:00Z"); // 周三
    const start = bucketStartMs(wed, "week");
    expect(new Date(start).getUTCDay()).toBe(1); // 周一
  });
});
