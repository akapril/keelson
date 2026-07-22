import { describe, it, expect } from "vitest";
import { computeRange } from "./report-range";

// 固定 now：2026-07-22（周三，本地时区）10:00
const NOW = new Date("2026-07-22T10:00:00");

describe("computeRange", () => {
  it("本周：周一起、跨 7 天、含 now、标签以「本周」开头", () => {
    const r = computeRange("this-week", NOW);
    expect(new Date(r.sinceMs).getDay()).toBe(1); // 周一
    expect(r.sinceMs).toBeLessThanOrEqual(NOW.getTime());
    expect(r.untilMs).toBeGreaterThanOrEqual(NOW.getTime());
    expect(r.label.startsWith("本周")).toBe(true);
    // 起点 00:00、终点当日 23:59:59.999，跨度约 7 天
    const days = (r.untilMs - r.sinceMs) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7);
  });

  it("上周：整体早于本周、且以周一起", () => {
    const cur = computeRange("this-week", NOW);
    const prev = computeRange("last-week", NOW);
    expect(prev.untilMs).toBeLessThan(cur.sinceMs);
    expect(new Date(prev.sinceMs).getDay()).toBe(1);
    expect(prev.label.startsWith("上周")).toBe(true);
  });

  it("近 7 天：起点为 now 前 6 日 00:00、终点为今日末", () => {
    const r = computeRange("last-7", NOW);
    const start = new Date(r.sinceMs);
    expect(start.getHours()).toBe(0);
    expect(start.getDate()).toBe(16); // 22 - 6
    expect(new Date(r.untilMs).getDate()).toBe(22);
    expect(r.label.startsWith("近 7 天")).toBe(true);
  });

  it("近 30 天：起点为 now 前 29 日", () => {
    const r = computeRange("last-30", NOW);
    const days = (r.untilMs - r.sinceMs) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30);
  });

  it("自定义：起止反了自动交换", () => {
    const r = computeRange("custom", NOW, { from: "2026-07-20", to: "2026-07-10" });
    expect(r.sinceMs).toBeLessThan(r.untilMs);
    expect(new Date(r.sinceMs).getDate()).toBe(10);
    expect(new Date(r.untilMs).getDate()).toBe(20);
  });

  it("自定义：缺省/非法日期回退到今天", () => {
    const r = computeRange("custom", NOW, { from: "", to: "" });
    expect(new Date(r.sinceMs).getDate()).toBe(22);
    expect(new Date(r.untilMs).getDate()).toBe(22);
  });
});
