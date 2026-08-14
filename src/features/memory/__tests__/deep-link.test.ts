import { describe, it, expect } from "vitest";
import { indexOfMemory } from "../deep-link";

describe("indexOfMemory", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("id 为空/未命中返回 -1", () => {
    expect(indexOfMemory(list, null)).toBe(-1);
    expect(indexOfMemory(list, "")).toBe(-1);
    expect(indexOfMemory(list, "x")).toBe(-1);
  });
  it("命中返回下标", () => {
    expect(indexOfMemory(list, "b")).toBe(1);
  });
});
