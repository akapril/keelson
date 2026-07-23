import { describe, it, expect } from "vitest";
import { expandRecurringEvents, firstIndexInRange } from "./recurrence";
import type { CalendarEvent } from "@/types/calendar";

function ev(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "e1",
    owner: "u",
    title: "T",
    description: "",
    start: "2026-07-01T09:00:00.000Z",
    end: "",
    all_day: false,
    color: "",
    project: "",
    repeat: "",
    created: "",
    updated: "",
    ...over,
  };
}

const R0 = new Date("2026-07-01T00:00:00.000Z");
const R1 = new Date("2026-07-31T23:59:59.999Z");

describe("expandRecurringEvents", () => {
  it("非重复事件原样返回一条", () => {
    const out = expandRecurringEvents([ev({})], R0, R1);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("e1");
  });

  it("每天：7 月内展开 31 天", () => {
    const out = expandRecurringEvents([ev({ repeat: "daily" })], R0, R1);
    expect(out).toHaveLength(31);
    expect(out.every((o) => o.id === "e1")).toBe(true); // 保留母 id
  });

  it("每周：7 月内约 5 次", () => {
    const out = expandRecurringEvents([ev({ repeat: "weekly" })], R0, R1);
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out.length).toBeLessThanOrEqual(5);
  });

  it("每月：区间内 1 次(7/1)", () => {
    const out = expandRecurringEvents([ev({ repeat: "monthly" })], R0, R1);
    expect(out).toHaveLength(1);
  });

  it("每年：母事件在更早年份也能命中当年", () => {
    const out = expandRecurringEvents(
      [ev({ start: "2020-07-15T09:00:00.000Z", repeat: "yearly" })],
      R0,
      R1,
    );
    expect(out).toHaveLength(1);
    expect(new Date(out[0].start).getUTCFullYear()).toBe(2026);
  });

  it("occurrence 平移保留时长(end 相对 start)", () => {
    const out = expandRecurringEvents(
      [ev({ start: "2026-07-01T09:00:00.000Z", end: "2026-07-01T10:00:00.000Z", repeat: "daily" })],
      R0,
      R1,
    );
    const dur = new Date(out[5].end).getTime() - new Date(out[5].start).getTime();
    expect(dur).toBe(3_600_000); // 1h
  });
});

describe("firstIndexInRange", () => {
  it("母事件晚于区间起点 → 0", () => {
    expect(firstIndexInRange("daily", new Date("2026-07-10"), R0)).toBe(0);
  });
  it("每天：快进跳过区间前的天数", () => {
    const base = new Date("2026-06-01T00:00:00.000Z");
    const idx = firstIndexInRange("daily", base, R0);
    expect(idx).toBe(30); // 6/1 → 7/1 = 30 天
  });
});
