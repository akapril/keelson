import { describe, it, expect } from "vitest";
import {
  parsePlanTasks,
  parseTaskmasterTasks,
  parseDocTitle,
  specNameForPlan,
  taskAnchor,
} from "./plan-import";

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

  it("跳过代码围栏内的 ### Task 样例（不当真任务）", () => {
    const withFence = `### Task 1: 真任务

演示解析的测试样例：
\`\`\`ts
const md = \`
### Task 1: 假的建命令
### Task 2：假的中文冒号
## 假小节
\`;
\`\`\`
正文继续，仍属真任务 1`;
    const ts = parsePlanTasks(withFence);
    expect(ts.length).toBe(1);
    expect(ts[0].title).toBe("真任务");
    // 围栏内容仍在 body 里，但没被拆成额外任务
    expect(ts[0].body).toContain("假的建命令");
    expect(ts[0].body).toContain("正文继续");
  });
});

describe("parsePlanTasks — 通用复选框格式 (Spec Kit / Kiro)", () => {
  it("Spec Kit: - [ ] T001 …，去编号/[P] 标记", () => {
    const md = `# Tasks

- [ ] T001 建项目结构
- [ ] T002 [P] 配置 lint
- [x] T003 已完成项`;
    const ts = parsePlanTasks(md);
    expect(ts.length).toBe(3);
    expect(ts[0].title).toBe("建项目结构");
    expect(ts[0].done).toBe(false);
    expect(ts[1].title).toBe("配置 lint"); // 去掉 T002 与 [P]
    expect(ts[2].title).toBe("已完成项"); // [x] 也算
    expect(ts[2].done).toBe(true); // [x] → done
  });

  it("Kiro: - [ ] 1. …，子复选框并入 body 不另成卡", () => {
    const md = `# 实现计划

- [ ] 1. 建模型
  - 定义字段
  - [ ] 1.1 校验规则
- [ ] 2. 建接口`;
    const ts = parsePlanTasks(md);
    expect(ts.length).toBe(2); // 只有两个顶层任务
    expect(ts[0].title).toBe("建模型");
    expect(ts[0].body).toContain("定义字段");
    expect(ts[0].body).toContain("1.1 校验规则"); // 子项在 body
    expect(ts[1].title).toBe("建接口");
  });

  it("superpowers 计划里的 - [ ] 步骤不被当成独立卡（走 ### Task 路线）", () => {
    const md = `### Task 1: 建命令

- [ ] 写失败测试
- [ ] 实现
- [ ] 提交`;
    const ts = parsePlanTasks(md);
    expect(ts.length).toBe(1); // 一个 Task，步骤在 body
    expect(ts[0].title).toBe("建命令");
    expect(ts[0].body).toContain("写失败测试");
  });

  it("跳过围栏内的复选框样例", () => {
    const md = `- [ ] 真任务

\`\`\`md
- [ ] 假任务示例
\`\`\``;
    const ts = parsePlanTasks(md);
    expect(ts.length).toBe(1);
    expect(ts[0].title).toBe("真任务");
  });
});

describe("parseTaskmasterTasks (claude-task-master tasks.json)", () => {
  it("打标签结构 {master:{tasks}}，subtasks 转 - [ ]", () => {
    const json = JSON.stringify({
      master: {
        tasks: [
          {
            id: 1,
            title: "初始化仓库",
            description: "建库并搭结构",
            details: "用 GitHub client",
            subtasks: [{ id: 1, title: "配置 OAuth" }, { id: 2, title: "回调处理" }],
          },
          { id: 2, title: "实现登录" },
        ],
      },
    });
    const ts = parseTaskmasterTasks(json);
    expect(ts.length).toBe(2);
    expect(ts[0].n).toBe(1);
    expect(ts[0].title).toBe("初始化仓库");
    expect(ts[0].body).toContain("建库并搭结构");
    expect(ts[0].body).toContain("用 GitHub client");
    expect(ts[0].body).toContain("- [ ] 配置 OAuth");
    expect(ts[1].title).toBe("实现登录");
  });

  it("扁平结构 {tasks} + status:done → done", () => {
    const json = JSON.stringify({
      tasks: [
        { id: 5, title: "任务A", status: "pending" },
        { id: 6, title: "任务B", status: "done" },
      ],
    });
    const ts = parseTaskmasterTasks(json);
    expect(ts.length).toBe(2);
    expect(ts[0].n).toBe(5);
    expect(ts[0].title).toBe("任务A");
    expect(ts[0].done).toBe(false);
    expect(ts[1].done).toBe(true); // status:done
  });

  it("坏 JSON / 无标题 → 稳健返回", () => {
    expect(parseTaskmasterTasks("not json")).toEqual([]);
    expect(parseTaskmasterTasks(JSON.stringify({ tasks: [{ id: 1 }] }))).toEqual([]);
  });
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
