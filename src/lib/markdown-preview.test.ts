import { describe, it, expect } from "vitest";
import { stripMarkdown } from "./markdown-preview";

describe("stripMarkdown", () => {
  it("去标题与列表标记", () => {
    expect(stripMarkdown("## 标题\n- 项一\n- 项二")).toBe("标题 项一 项二");
  });
  it("去粗体/斜体/行内代码", () => {
    expect(stripMarkdown("**粗** _斜_ `代码`")).toBe("粗 斜 代码");
  });
  it("链接取文本，图片去掉", () => {
    expect(stripMarkdown("看 [文档](http://x) 和 ![图](http://y)")).toBe("看 文档 和");
  });
  it("围栏代码块折叠", () => {
    expect(stripMarkdown("说明\n```ts\nconst a=1\n```\n结束")).toBe("说明 结束");
  });
  it("多行折叠为单空格、去首尾空白", () => {
    expect(stripMarkdown("  行一\n\n行二  ")).toBe("行一 行二");
  });
  it("空输入返回空", () => expect(stripMarkdown("")).toBe(""));
});
