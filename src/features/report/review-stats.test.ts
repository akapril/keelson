import { describe, it, expect } from "vitest";
import {
  buildDailyBuckets,
  aggregateByType,
  aggregateByProject,
} from "./review-stats";
import type { ReportMaterial } from "./report-collect";
import type { DateRange } from "./report-range";

// 最小工厂（只填被读到的字段）
/* eslint-disable @typescript-eslint/no-explicit-any */
const commit = (iso: string): any => ({ hash: iso, short: "x", subject: "s", committed_at: iso });
const task = (iso: string): any => ({ id: iso, title: "t", updated: iso });
const sess = (iso: string): any => ({ session_id: iso, updated_at: iso });

const material = (over: Partial<ReportMaterial>): ReportMaterial => ({
  rangeLabel: "x",
  commitGroups: [],
  taskGroups: [],
  sessionGroups: [],
  ...over,
});

// range：2026-09-01 00:00 .. 2026-09-03 23:59:59.999（本地）
const range: DateRange = {
  sinceISO: "",
  untilISO: "",
  sinceMs: new Date("2026-09-01T00:00:00").getTime(),
  untilMs: new Date("2026-09-03T23:59:59.999").getTime(),
  label: "x",
};

describe("buildDailyBuckets", () => {
  it("预置 range 每天为 0 并按本地日累加", () => {
    const m = material({
      commitGroups: [
        { label: "P", commits: [commit("2026-09-02T10:00:00"), commit("2026-09-02T12:00:00")] },
      ],
      taskGroups: [{ label: "P", tasks: [task("2026-09-02T09:00:00")] }],
      sessionGroups: [{ label: "P", sessions: [sess("2026-09-03T08:00:00")] }],
    });
    const b = buildDailyBuckets(m, range);
    expect(b.size).toBe(3);
    expect(b.get("2026-09-01")).toEqual({ commits: 0, tasks: 0, sessions: 0, total: 0 });
    expect(b.get("2026-09-02")).toEqual({ commits: 2, tasks: 1, sessions: 0, total: 3 });
    expect(b.get("2026-09-03")).toEqual({ commits: 0, tasks: 0, sessions: 1, total: 1 });
  });

  it("range 外的 item 跳过、网格恰好 range 天数", () => {
    const m = material({
      commitGroups: [{ label: "P", commits: [commit("2026-08-15T10:00:00")] }],
    });
    const b = buildDailyBuckets(m, range);
    expect(b.size).toBe(3);
    expect([...b.values()].every((v) => v.total === 0)).toBe(true);
  });
});

describe("aggregateByType", () => {
  it("按类型求和", () => {
    const m = material({
      commitGroups: [
        { label: "A", commits: [commit("x"), commit("y")] },
        { label: "B", commits: [commit("z")] },
      ],
      taskGroups: [{ label: "A", tasks: [task("x")] }],
    });
    expect(aggregateByType(m)).toEqual({ commits: 3, tasks: 1, sessions: 0 });
  });
});

describe("aggregateByProject", () => {
  it("按 label 归并、total 降序", () => {
    const m = material({
      commitGroups: [
        { label: "A", commits: [commit("x"), commit("y")] },
        { label: "B", commits: [commit("z")] },
      ],
      taskGroups: [{ label: "B", tasks: [task("x"), task("y")] }],
    });
    const r = aggregateByProject(m);
    expect(r[0]).toEqual({ label: "B", commits: 1, tasks: 2, sessions: 0, total: 3 });
    expect(r[1]).toEqual({ label: "A", commits: 2, tasks: 0, sessions: 0, total: 2 });
  });
});
