import { describe, it, expect } from "vitest";
import { relativeTime } from "../SessionCard";

describe("relativeTime", () => {
  const now = Date.parse("2026-07-20T12:00:00Z");

  it("刚刚 / 分钟 / 小时 / 天", () => {
    expect(relativeTime("2026-07-20T11:59:30Z", now)).toBe("刚刚"); // 30s
    expect(relativeTime("2026-07-20T11:30:00Z", now)).toBe("30 分钟前");
    expect(relativeTime("2026-07-20T09:00:00Z", now)).toBe("3 小时前");
    expect(relativeTime("2026-07-18T12:00:00Z", now)).toBe("2 天前");
  });

  it("超 7 天 → MM-DD", () => {
    expect(relativeTime("2026-07-01T12:00:00Z", now)).toMatch(/^\d{2}-\d{2}$/);
  });

  it("解析失败 → 空串", () => {
    expect(relativeTime("not-a-date", now)).toBe("");
  });

  it("未来时间按 0 处理 → 刚刚", () => {
    expect(relativeTime("2026-07-20T13:00:00Z", now)).toBe("刚刚");
  });
});
