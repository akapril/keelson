import { describe, it, expect } from "vitest";
import { parseHeadings } from "./toc";

describe("parseHeadings", () => {
  it("空正文返回空", () => {
    expect(parseHeadings("")).toEqual([]);
  });

  it("解析多级标题并按序编号", () => {
    const md = "# 一级\n正文\n## 二级\n### 三级\n";
    expect(parseHeadings(md)).toEqual([
      { level: 1, text: "一级", index: 0 },
      { level: 2, text: "二级", index: 1 },
      { level: 3, text: "三级", index: 2 },
    ]);
  });

  it("跳过围栏代码块内的 # 行", () => {
    const md = ["# 真标题", "```bash", "# 这是注释不是标题", "echo hi", "```", "## 真二级"].join("\n");
    expect(parseHeadings(md)).toEqual([
      { level: 1, text: "真标题", index: 0 },
      { level: 2, text: "真二级", index: 1 },
    ]);
  });

  it("支持 ~~~ 围栏", () => {
    const md = ["~~~", "# 代码内", "~~~", "# 代码外"].join("\n");
    expect(parseHeadings(md)).toEqual([{ level: 1, text: "代码外", index: 0 }]);
  });

  it("去掉 ATX 尾随 # 与首尾空白", () => {
    expect(parseHeadings("##   标题  ##")).toEqual([
      { level: 2, text: "标题", index: 0 },
    ]);
  });

  it("忽略无空格的 #（非标题）与空标题", () => {
    expect(parseHeadings("#无空格\n## ")).toEqual([]);
  });

  it("最多 6 级，7 个 # 不算标题", () => {
    expect(parseHeadings("####### 七级")).toEqual([]);
  });
});
