import { describe, it, expect } from "vitest";
import { backTarget } from "./back-target";

describe("backTarget 返回来源判定（S5）", () => {
  it("深链带 open 且非收藏 → 后退回来源", () => {
    expect(backTarget("abc", false)).toBe("back");
  });
  it("侧栏收藏进入(from=fav) → 回项目列表", () => {
    expect(backTarget("abc", true)).toBe("list");
  });
  it("列表点开(无 open) → 回项目列表", () => {
    expect(backTarget(null, false)).toBe("list");
  });
  it("无 open 即便带 from=fav → 回项目列表", () => {
    expect(backTarget(null, true)).toBe("list");
  });
});
