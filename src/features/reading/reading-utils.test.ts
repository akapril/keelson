import { describe, it, expect } from "vitest";
import { parseSummary, salvageSummary, splitTags, joinTags, groupReading } from "./reading-utils";
import type { ReadingItem } from "@/types/reading";

function item(p: Partial<ReadingItem>): ReadingItem {
  return {
    id: "x", owner: "o", title: "t", url: "", note: "", status: "unread",
    tags: "", summary: "", key_points: "", content_text: "", pinned: false,
    created: "2026-07-01T00:00:00Z", updated: "2026-07-01T00:00:00Z", ...p,
  };
}

describe("parseSummary", () => {
  it("解析正常 JSON（含 tags）", () => {
    const r = parseSummary('{"summary":"一句话","key_points":["a","b"],"tags":["t1","t2"]}');
    expect(r).toEqual({ summary: "一句话", key_points: ["a", "b"], tags: ["t1", "t2"] });
  });
  it("剥离 ```json 围栏", () => {
    const r = parseSummary('```json\n{"summary":"s","key_points":["x"]}\n```');
    expect(r?.summary).toBe("s");
    expect(r?.key_points).toEqual(["x"]);
  });
  it("非法 JSON 返回 null", () => {
    expect(parseSummary("not json")).toBeNull();
  });
  it("缺 summary 字段返回 null；key_points/tags 缺失则空数组", () => {
    expect(parseSummary('{"key_points":["a"]}')).toBeNull();
    expect(parseSummary('{"summary":"s"}')).toEqual({ summary: "s", key_points: [], tags: [] });
  });
});

describe("salvageSummary（解析失败时从半截 JSON 捞可读文本，不丢原始 JSON）", () => {
  it("截断的 JSON（summary 未闭合）→ 捞出已写部分", () => {
    // max_tokens 太小,JSON 被截断在 summary 中途
    const truncated = '{"summary":"这是一段被截断的摘要,后面还没写完';
    expect(salvageSummary(truncated)).toBe("这是一段被截断的摘要,后面还没写完");
  });
  it("完整 summary 字段 → 只取其值,不含花括号/其他字段", () => {
    const s = '{"summary":"完整摘要","key_points":["a"],"tags":["t"]}';
    expect(salvageSummary(s)).toBe("完整摘要");
  });
  it("反转义 \\n \\\" → 还原换行与引号", () => {
    expect(salvageSummary('{"summary":"第一行\\n第二\\"引\\"行"}')).toBe('第一行\n第二"引"行');
  });
  it("带 ```json 围栏的截断 JSON → 剥围栏后捞 summary", () => {
    expect(salvageSummary('```json\n{"summary":"围栏里的摘要')).toBe("围栏里的摘要");
  });
  it("纯散文回复（无 summary 字段）→ 原样返回可读文本", () => {
    expect(salvageSummary("这是一段纯散文，AI 没按 JSON 返回。")).toBe(
      "这是一段纯散文，AI 没按 JSON 返回。",
    );
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
