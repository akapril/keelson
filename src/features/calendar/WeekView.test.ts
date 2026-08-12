import { describe, it, expect } from "vitest";
import { layoutDayEvents, parseHM, isTimedEvent } from "./WeekView";
import type { CalendarEvent } from "@/types/calendar";

// 构造一个时段事件（默认非全天、带时刻）
function ev(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "e1",
    owner: "u",
    title: "T",
    description: "",
    start: "2026-08-12",
    end: "",
    start_time: "09:00",
    end_time: "10:00",
    all_day: false,
    color: "",
    project: "",
    repeat: "",
    created: "",
    updated: "",
    ...over,
  };
}

describe("parseHM", () => {
  it("解析合法 HH:mm 为分钟数", () => {
    expect(parseHM("00:00")).toBe(0);
    expect(parseHM("09:30")).toBe(570);
    expect(parseHM("23:59")).toBe(1439);
  });
  it("非法输入返回 null", () => {
    expect(parseHM("")).toBeNull();
    expect(parseHM(undefined)).toBeNull();
    expect(parseHM("24:00")).toBeNull();
    expect(parseHM("9")).toBeNull();
    expect(parseHM("ab:cd")).toBeNull();
  });
});

describe("isTimedEvent", () => {
  it("非全天 + 有 start_time → true", () => {
    expect(isTimedEvent(ev({}))).toBe(true);
  });
  it("全天 → false", () => {
    expect(isTimedEvent(ev({ all_day: true }))).toBe(false);
  });
  it("无 start_time → false", () => {
    expect(isTimedEvent(ev({ start_time: "" }))).toBe(false);
  });
});

describe("layoutDayEvents", () => {
  it("过滤掉全天/无时刻事件", () => {
    const out = layoutDayEvents([
      ev({ id: "a" }),
      ev({ id: "b", all_day: true }),
      ev({ id: "c", start_time: "" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].ev.id).toBe("a");
  });

  it("单个事件占满整列（colCount=1）", () => {
    const out = layoutDayEvents([ev({ start_time: "09:00", end_time: "10:00" })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ startMin: 540, endMin: 600, colIndex: 0, colCount: 1 });
  });

  it("无 end_time → 默认 60 分钟", () => {
    const out = layoutDayEvents([ev({ start_time: "09:00", end_time: "" })]);
    expect(out[0].endMin - out[0].startMin).toBe(60);
  });

  it("end_time <= start_time → 回退 60 分钟", () => {
    const out = layoutDayEvents([ev({ start_time: "09:00", end_time: "08:00" })]);
    expect(out[0].endMin - out[0].startMin).toBe(60);
  });

  it("不重叠的两个事件各占一列（colCount=1）", () => {
    const out = layoutDayEvents([
      ev({ id: "a", start_time: "09:00", end_time: "10:00" }),
      ev({ id: "b", start_time: "10:00", end_time: "11:00" }),
    ]);
    expect(out.every((o) => o.colCount === 1 && o.colIndex === 0)).toBe(true);
  });

  it("两个重叠事件 → 平分 2 列", () => {
    const out = layoutDayEvents([
      ev({ id: "a", start_time: "09:00", end_time: "10:30" }),
      ev({ id: "b", start_time: "10:00", end_time: "11:00" }),
    ]);
    const a = out.find((o) => o.ev.id === "a")!;
    const b = out.find((o) => o.ev.id === "b")!;
    expect(a.colCount).toBe(2);
    expect(b.colCount).toBe(2);
    expect(new Set([a.colIndex, b.colIndex])).toEqual(new Set([0, 1]));
  });

  it("三个互相重叠 → 3 列", () => {
    const out = layoutDayEvents([
      ev({ id: "a", start_time: "09:00", end_time: "12:00" }),
      ev({ id: "b", start_time: "09:30", end_time: "12:00" }),
      ev({ id: "c", start_time: "10:00", end_time: "12:00" }),
    ]);
    expect(out.every((o) => o.colCount === 3)).toBe(true);
    expect(new Set(out.map((o) => o.colIndex))).toEqual(new Set([0, 1, 2]));
  });

  it("链式：A∩B、B∩C 但 A 不∩ C → 同一簇 2 列，A/C 复用列 0", () => {
    // A 09:00-10:00, B 09:30-10:30, C 10:00-11:00
    // A 与 B 重叠、B 与 C 重叠；A 与 C 边界相接不重叠(10:00 >= 10:00)
    // 期望：整体为一个重叠簇(通过 B 串联) colCount=2；C 可复用 A 结束后的列 0
    const out = layoutDayEvents([
      ev({ id: "a", start_time: "09:00", end_time: "10:00" }),
      ev({ id: "b", start_time: "09:30", end_time: "10:30" }),
      ev({ id: "c", start_time: "10:00", end_time: "11:00" }),
    ]);
    const a = out.find((o) => o.ev.id === "a")!;
    const b = out.find((o) => o.ev.id === "b")!;
    const c = out.find((o) => o.ev.id === "c")!;
    expect(a.colCount).toBe(2);
    expect(a.colIndex).toBe(0);
    expect(b.colIndex).toBe(1);
    expect(c.colIndex).toBe(0); // 复用 A 腾出的列 0
  });

  it("两个独立簇互不影响列数", () => {
    const out = layoutDayEvents([
      ev({ id: "a", start_time: "09:00", end_time: "10:00" }),
      ev({ id: "b", start_time: "09:30", end_time: "10:30" }), // 与 a 重叠 → 簇1(2列)
      ev({ id: "c", start_time: "14:00", end_time: "15:00" }), // 独立 → 簇2(1列)
    ]);
    const c = out.find((o) => o.ev.id === "c")!;
    expect(c.colCount).toBe(1);
    expect(c.colIndex).toBe(0);
  });
});
