import { describe, it, expect } from "vitest";
import { parseWikiLinks, contentLinksTo } from "./wiki-links";

describe("parseWikiLinks", () => {
  it("空正文返回空", () => {
    expect(parseWikiLinks("")).toEqual([]);
  });

  it("提取 [[标题]] 目标", () => {
    expect(parseWikiLinks("见 [[设计文档]] 和 [[API 约定]]。")).toEqual([
      "设计文档",
      "API 约定",
    ]);
  });

  it("[[标题|别名]] 取标题部分", () => {
    expect(parseWikiLinks("参考 [[项目 Spec|这份 spec]]")).toEqual(["项目 Spec"]);
  });

  it("去重（大小写不敏感，保留首次形态）", () => {
    expect(parseWikiLinks("[[Doc]] 又见 [[doc]] 与 [[DOC]]")).toEqual(["Doc"]);
  });

  it("跳过围栏代码块内的 [[ ]]", () => {
    const md = ["[[真链接]]", "```", "[[代码内不算]]", "```", "[[另一个]]"].join("\n");
    expect(parseWikiLinks(md)).toEqual(["真链接", "另一个"]);
  });

  it("空的 [[]] 不计入", () => {
    expect(parseWikiLinks("[[]] 和 [[  ]] 与 [[有效]]")).toEqual(["有效"]);
  });

  it("contentLinksTo 大小写不敏感匹配", () => {
    expect(contentLinksTo("见 [[设计文档]]", "设计文档")).toBe(true);
    expect(contentLinksTo("见 [[Design]]", "design")).toBe(true);
    expect(contentLinksTo("无引用", "设计文档")).toBe(false);
  });
});
