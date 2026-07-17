import { describe, it, expect } from "vitest";
import { parseSummary, splitTags, joinTags, groupReading } from "./reading-utils";
import type { ReadingItem } from "@/types/reading";

function item(p: Partial<ReadingItem>): ReadingItem {
  return {
    id: "x", owner: "o", title: "t", url: "", note: "", status: "unread",
    tags: "", summary: "", key_points: "", content_text: "", pinned: false,
    created: "2026-07-01T00:00:00Z", updated: "2026-07-01T00:00:00Z", ...p,
  };
}

describe("parseSummary", () => {
  it("解析正常 JSON", () => {
    const r = parseSummary('{"summary":"一句话","key_points":["a","b"]}');
    expect(r).toEqual({ summary: "一句话", key_points: ["a", "b"] });
  });
  it("剥离 ```json 围栏", () => {
    const r = parseSummary('```json\n{"summary":"s","key_points":["x"]}\n```');
    expect(r?.summary).toBe("s");
    expect(r?.key_points).toEqual(["x"]);
  });
  it("非法 JSON 返回 null", () => {
    expect(parseSummary("not json")).toBeNull();
  });
  it("缺 summary 字段返回 null；key_points 缺失则空数组", () => {
    expect(parseSummary('{"key_points":["a"]}')).toBeNull();
    expect(parseSummary('{"summary":"s"}')).toEqual({ summary: "s", key_points: [] });
  });
});

describe("splitTags / joinTags", () => {
  it("拆分:去空白、去空、去重", () => {
    expect(splitTags("a, b ,, a ,c")).toEqual(["a", "b", "c"]);
    expect(splitTags("")).toEqual([]);
  });
  it("合并:逗号分隔", () => {
    expect(joinTags(["a", "b"])).toBe("a,b");
    expect(joinTags([])).toBe("");
  });
});

describe("groupReading", () => {
  it("按 pinned 拆分,保序", () => {
    const a = item({ id: "a", pinned: true });
    const b = item({ id: "b", pinned: false });
    const c = item({ id: "c", pinned: true });
    const g = groupReading([a, b, c]);
    expect(g.pinned.map((x) => x.id)).toEqual(["a", "c"]);
    expect(g.rest.map((x) => x.id)).toEqual(["b"]);
  });
});
