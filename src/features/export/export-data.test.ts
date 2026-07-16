import { describe, it, expect } from "vitest";
import { toJson, toMarkdown, type ExportBundle } from "./export-data";

// 最小可用的导出包：一个项目、两个状态、两个任务、一篇文档
const bundle: ExportBundle = {
  version: 1,
  exportedAt: "2026-07-16T00:00:00.000Z",
  projects: [
    {
      project: {
        id: "p1",
        name: "示例项目",
        description: "描述",
      } as ExportBundle["projects"][0]["project"],
      states: [
        { id: "s1", name: "待办", sort_order: 1 } as never,
        { id: "s2", name: "完成", sort_order: 2 } as never,
      ],
      labels: [],
      tasks: [
        { id: "t1", state: "s1", title: "任务A", priority: "high", rank: 1, due_date: "2026-08-01 00:00:00" } as never,
        { id: "t2", state: "s2", title: "任务B", priority: "none", rank: 1 } as never,
      ],
      docs: [{ id: "d1", title: "设计", content: "# 标题\n正文" } as never],
    },
  ],
};

describe("toJson", () => {
  it("产出可解析且保留结构的 JSON", () => {
    const parsed = JSON.parse(toJson(bundle));
    expect(parsed.version).toBe(1);
    expect(parsed.projects[0].tasks).toHaveLength(2);
  });
});

describe("toMarkdown", () => {
  const md = toMarkdown(bundle);
  it("包含项目名、状态分组与任务", () => {
    expect(md).toContain("## 项目：示例项目");
    expect(md).toContain("#### 待办（1）");
    expect(md).toContain("[high] 任务A");
    expect(md).toContain("@2026-08-01"); // 截止日期只取日期部分
  });
  it("priority=none 不加优先级前缀", () => {
    expect(md).toContain("- 任务B");
    expect(md).not.toContain("[none]");
  });
  it("包含文档标题与正文", () => {
    expect(md).toContain("#### 设计");
    expect(md).toContain("正文");
  });
});
