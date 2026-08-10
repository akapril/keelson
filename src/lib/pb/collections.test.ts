import { describe, it, expect } from "vitest";
import { combineFilters, NOT_DELETED } from "./collections";

describe("combineFilters", () => {
  it("忽略空片段，用 && 连接", () => {
    expect(combineFilters(NOT_DELETED, 'project = "p1"')).toBe(
      'deleted_at = "" && project = "p1"',
    );
  });
  it("全空返回空串", () => {
    expect(combineFilters(undefined, "", undefined)).toBe("");
  });
  it("单片段原样返回", () => {
    expect(combineFilters(NOT_DELETED)).toBe('deleted_at = ""');
  });
});
