import { describe, it, expect } from "vitest";
import { parseMemories, normalize, isDuplicate, classifyCandidates, cosine, classifyBySimilarity } from "./extract";
import type { Memory, MemoryKind, MemoryScope } from "@/types/memory";
import type { MemoryCandidate } from "./extract";

const mem = (id: string, content: string, kind = "fact", scope = "project"): Memory =>
  ({
    id,
    content,
    kind,
    scope,
    project: "",
    confidence: 50,
    owner: "u",
    source_session_id: "",
    source_provider: "",
    source_anchor: "",
    superseded_by: "",
    created: "",
    updated: "",
  }) as Memory;

describe("parseMemories", () => {
  it("解析严格 JSON + 校验 kind/scope，非法字段回退", () => {
    const r = parseMemories(
      '{"memories":[{"content":"用中文注释","kind":"preference","scope":"global","confidence":80},{"content":"","kind":"x"},{"content":"选 Tantivy","kind":"bad","scope":"bad"}]}',
    );
    expect(r).toHaveLength(2); // 空 content 丢弃
    expect(r[0]).toMatchObject({ content: "用中文注释", kind: "preference", scope: "global", confidence: 80 });
    expect(r[1]).toMatchObject({ kind: "fact", scope: "project" }); // 非法回退
  });
  it("去代码围栏 + 噪声", () => {
    const r = parseMemories('```json\n{"memories":[{"content":"x","kind":"fact","scope":"project"}]}\n```');
    expect(r).toHaveLength(1);
  });
  it("非法/空 → 空数组", () => {
    expect(parseMemories("not json")).toEqual([]);
    expect(parseMemories("")).toEqual([]);
  });
});

describe("normalize / isDuplicate", () => {
  it("规范化去空白标点大小写", () => {
    expect(normalize("Use  Chinese, comments!")).toBe("usechinesecomments");
  });
  it("同 kind+scope 且文本相等/包含 → 重复", () => {
    const a = { content: "用中文注释", kind: "preference" as const, scope: "global" as const };
    const b = { content: "用中文注释。", kind: "preference" as const, scope: "global" as const };
    expect(isDuplicate(a, b)).toBe(true);
  });
  it("不同 kind → 不重复", () => {
    const a = { content: "x", kind: "fact" as const, scope: "project" as const };
    const b = { content: "x", kind: "decision" as const, scope: "project" as const };
    expect(isDuplicate(a, b)).toBe(false);
  });
});

describe("classifyCandidates", () => {
  it("命中已有→duplicateOf=id；全新→null；批内重复→空串", () => {
    const existing = [mem("m1", "用中文注释", "preference", "global")];
    const cands = [
      { content: "用中文注释", kind: "preference" as const, scope: "global" as const, confidence: 80 }, // 命中 m1
      { content: "选 Tantivy 做检索", kind: "decision" as const, scope: "project" as const, confidence: 70 }, // 新
      { content: "选 Tantivy 做检索", kind: "decision" as const, scope: "project" as const, confidence: 60 }, // 批内重复
    ];
    const out = classifyCandidates(cands, existing);
    expect(out[0].duplicateOf).toBe("m1");
    expect(out[1].duplicateOf).toBeNull();
    expect(out[2].duplicateOf).toBe("");
  });
});

describe("cosine", () => {
  it("同向量为 1", () => expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1));
  it("正交为 0", () => expect(cosine([1, 0], [0, 1])).toBeCloseTo(0));
  it("零向量为 0", () => expect(cosine([0, 0], [1, 1])).toBe(0));
});

describe("classifyBySimilarity", () => {
  const cand = (content: string, scope: "global" | "project" = "project") =>
    ({ content, kind: "fact", scope, confidence: 50 }) as MemoryCandidate;
  const mem2 = (id: string, content: string, scope: "global" | "project" = "project") =>
    ({ id, content, kind: "fact", scope, superseded_by: "" }) as unknown as Memory;

  it("与已有语义相同 → duplicateOf 命中 id", () => {
    const c = [cand("用中文写注释")];
    const e = [mem2("m1", "注释使用中文")];
    const out = classifyBySimilarity(c, e, [[1, 0, 0]], [[1, 0, 0]], 0.86);
    expect(out[0].duplicateOf).toBe("m1");
  });

  it("语义不同 → fresh(null)", () => {
    const c = [cand("使用 Rust")];
    const e = [mem2("m1", "使用 Python")];
    const out = classifyBySimilarity(c, e, [[1, 0, 0]], [[0, 1, 0]], 0.86);
    expect(out[0].duplicateOf).toBeNull();
  });

  it("跨 kind 也判重（同 scope、向量相近）", () => {
    const c = [{ content: "偏好深色", kind: "preference", scope: "project", confidence: 50 } as MemoryCandidate];
    const e = [mem2("m1", "喜欢深色主题")]; // kind=fact
    const out = classifyBySimilarity(c, e, [[1, 0]], [[1, 0]], 0.86);
    expect(out[0].duplicateOf).toBe("m1");
  });

  it("不同 scope 不判重", () => {
    const c = [cand("同一句话", "global")];
    const e = [mem2("m1", "同一句话", "project")];
    const out = classifyBySimilarity(c, e, [[1, 0]], [[1, 0]], 0.86);
    expect(out[0].duplicateOf).toBeNull();
  });

  it("批内重复 → duplicateOf 空串", () => {
    const c = [cand("第一条"), cand("第一条近义")];
    const out = classifyBySimilarity(c, [], [[1, 0], [1, 0]], [], 0.86);
    expect(out[0].duplicateOf).toBeNull();
    expect(out[1].duplicateOf).toBe("");
  });
});
