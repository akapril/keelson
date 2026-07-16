import { describe, it, expect } from "vitest";
import { scoreRelevance, selectChunks } from "./project-rank";

describe("scoreRelevance", () => {
  it("命中比例 = 命中的 query 词数 / query 词数", () => {
    expect(scoreRelevance("login auth", "the login flow")).toBeCloseTo(0.5);
    expect(scoreRelevance("login auth", "login and auth here")).toBe(1);
  });
  it("query 无有效词时返回 0", () => {
    expect(scoreRelevance("", "anything")).toBe(0);
    expect(scoreRelevance("!! ??", "anything")).toBe(0);
  });
});

describe("selectChunks", () => {
  it("有 query 时按相关度降序（最相关在前）", () => {
    const chunks = ["about cats", "about login and auth", "about dogs"];
    const out = selectChunks(chunks, "login", 1000);
    expect(out.indexOf("login")).toBeLessThan(out.indexOf("cats"));
  });
  it("query 为空时保持原顺序并遵守预算", () => {
    const chunks = ["aaaa", "bbbb", "cccc"];
    const out = selectChunks(chunks, "", 6);
    expect(out.startsWith("aaaa")).toBe(true);
    expect(out).not.toContain("cccc");
  });
});
