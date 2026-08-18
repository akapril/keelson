import { describe, it, expect } from "vitest";
import { formatUptime, capacityLabel, memBarPercent } from "./runtime-format";

describe("formatUptime", () => {
  it("秒级", () => expect(formatUptime(45)).toBe("45s"));
  it("分级", () => expect(formatUptime(125)).toBe("2m"));
  it("时分", () => expect(formatUptime(3 * 3600 + 12 * 60)).toBe("3h 12m"));
});

describe("capacityLabel", () => {
  it("在跑/上限", () => expect(capacityLabel(3, 8)).toBe("3 / 8"));
});

describe("memBarPercent", () => {
  it("比例取整", () => expect(memBarPercent(50, 100)).toBe(50));
  it("total 0 → 0", () => expect(memBarPercent(5, 0)).toBe(0));
  it("上限 100", () => expect(memBarPercent(150, 100)).toBe(100));
});
