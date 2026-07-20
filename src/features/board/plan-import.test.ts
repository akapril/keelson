import { describe, it, expect } from "vitest";
import { parsePlanTasks, parseDocTitle, specNameForPlan, taskAnchor } from "./plan-import";

describe("parsePlanTasks", () => {
  const md = `# 标题

### Task 1: 建命令

**Files:** a.rs
正文一

### Task 2：中文冒号

正文二

## 其它小节
不该算任务`;

  it("切出两个任务", () => {
    const ts = parsePlanTasks(md);
    expect(ts.length).toBe(2);
    expect(ts[0].n).toBe(1);
    expect(ts[0].title).toBe("建命令");
    expect(ts[1].title).toBe("中文冒号");
  });
  it("body 到下一个 ###/## 截断", () => {
    const ts = parsePlanTasks(md);
    expect(ts[0].body).toContain("正文一");
    expect(ts[0].body).not.toContain("Task 2");
    expect(ts[1].body).toContain("正文二");
    expect(ts[1].body).not.toContain("不该算任务");
  });
  it("无任务返回空", () => expect(parsePlanTasks("# 只有标题\n正文").length).toBe(0));
});

describe("parseDocTitle", () => {
  it("取首个 #", () => expect(parseDocTitle("# 我的设计\n\n正文")).toBe("我的设计"));
  it("无标题空串", () => expect(parseDocTitle("正文无标题")).toBe(""));
});

describe("specNameForPlan / taskAnchor", () => {
  it("plan→spec 名", () =>
    expect(specNameForPlan("2026-07-20-foo.md")).toBe("2026-07-20-foo-design.md"));
  it("anchor", () => expect(taskAnchor("2026-07-20-foo.md", 3)).toBe("plan:2026-07-20-foo.md#task-3"));
});
