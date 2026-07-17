import { describe, it, expect } from "vitest";
import { inDueWindow } from "./due-reminders";

describe("inDueWindow", () => {
  const today = "2026-07-17";
  const cutoff = "2026-07-03"; // 回看 14 天

  it("当天截止 → 提醒", () => {
    expect(inDueWindow("2026-07-17", today, cutoff)).toBe(true);
  });

  it("已逾期但在窗口内 → 提醒", () => {
    expect(inDueWindow("2026-07-10", today, cutoff)).toBe(true);
    expect(inDueWindow("2026-07-03", today, cutoff)).toBe(true); // 边界=cutoff
  });

  it("未来截止 → 不提醒", () => {
    expect(inDueWindow("2026-07-18", today, cutoff)).toBe(false);
  });

  it("逾期太久(早于回看下限) → 不提醒(防刷屏)", () => {
    expect(inDueWindow("2026-07-02", today, cutoff)).toBe(false);
    expect(inDueWindow("2026-01-01", today, cutoff)).toBe(false);
  });

  it("空日期 → 不提醒", () => {
    expect(inDueWindow("", today, cutoff)).toBe(false);
  });
});
