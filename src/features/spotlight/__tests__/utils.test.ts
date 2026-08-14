// utils.test.ts — Spotlight 纯函数辅助测试
import { describe, it, expect } from "vitest";
import {
  recentSessions,
  filterSessions,
  sessionToItem,
  taskToItem,
  docToItem,
  buildItems,
  parsePrefix,
  formatInput,
  projectToItem,
  memoryToItem,
  memoryLabel,
  filterProjects,
  filterMemories,
} from "../utils";
import type { Session } from "../../../types/session";
import type { BoardTask } from "../../../types/board";
import type { BoardDoc } from "../../../types/docs";
import type { BoardProject } from "../../../types/board";
import type { Memory } from "../../../types/memory";

/** 构造最小化测试用 Session */
function makeSession(
  session_id: string,
  project_name: string,
  first_prompt: string,
  updated_at: string,
  project_path = "/workspace/test"
): Session {
  return {
    session_id,
    provider: "claude",
    project_path,
    project_name,
    first_prompt,
    last_prompt: first_prompt,
    created_at: "2024-01-01T00:00:00Z",
    updated_at,
    message_count: 0,
    user_messages: [],
    total_tokens: 0,
  };
}

describe("recentSessions", () => {
  it("空数组返回空数组", () => {
    expect(recentSessions([], 5)).toEqual([]);
  });

  it("按 updated_at 降序排列", () => {
    const sessions = [
      makeSession("a", "A", "prompt", "2024-01-01T00:00:00Z"),
      makeSession("b", "B", "prompt", "2024-01-03T00:00:00Z"),
      makeSession("c", "C", "prompt", "2024-01-02T00:00:00Z"),
    ];
    const result = recentSessions(sessions, 10);
    expect(result.map((s) => s.session_id)).toEqual(["b", "c", "a"]);
  });

  it("取前 N 条", () => {
    const sessions = [
      makeSession("a", "A", "p", "2024-01-03T00:00:00Z"),
      makeSession("b", "B", "p", "2024-01-02T00:00:00Z"),
      makeSession("c", "C", "p", "2024-01-01T00:00:00Z"),
    ];
    const result = recentSessions(sessions, 2);
    expect(result).toHaveLength(2);
    expect(result[0].session_id).toBe("a");
    expect(result[1].session_id).toBe("b");
  });

  it("不修改原数组顺序", () => {
    const sessions = [
      makeSession("a", "A", "p", "2024-01-01T00:00:00Z"),
      makeSession("b", "B", "p", "2024-01-03T00:00:00Z"),
    ];
    const original = sessions.map((s) => s.session_id);
    recentSessions(sessions, 10);
    // 原数组不变
    expect(sessions.map((s) => s.session_id)).toEqual(original);
  });
});

describe("filterSessions", () => {
  const sessions = [
    makeSession("a", "my-project", "implement auth feature", "2024-01-01T00:00:00Z", "/workspace/my-project"),
    makeSession("b", "other-app", "fix the login bug", "2024-01-02T00:00:00Z", "/workspace/other-app"),
    makeSession("c", "frontend", "update CSS styles", "2024-01-03T00:00:00Z", "/workspace/frontend"),
  ];

  it("空 query 返回全部", () => {
    expect(filterSessions(sessions, "")).toHaveLength(3);
    expect(filterSessions(sessions, "  ")).toHaveLength(3);
  });

  it("按 project_name 过滤", () => {
    const result = filterSessions(sessions, "my-project");
    expect(result).toHaveLength(1);
    expect(result[0].session_id).toBe("a");
  });

  it("按 first_prompt 过滤（忽略大小写）", () => {
    const result = filterSessions(sessions, "AUTH");
    expect(result).toHaveLength(1);
    expect(result[0].session_id).toBe("a");
  });

  it("按 project_path 过滤", () => {
    const result = filterSessions(sessions, "other-app");
    expect(result).toHaveLength(1);
    expect(result[0].session_id).toBe("b");
  });

  it("无匹配返回空数组", () => {
    expect(filterSessions(sessions, "nonexistent-xyz-123")).toHaveLength(0);
  });

  it("部分匹配跨多条", () => {
    // "fix" 只出现在 session b 的 last_prompt
    const result = filterSessions(sessions, "fix");
    expect(result).toHaveLength(1);
    expect(result[0].session_id).toBe("b");
  });
});

const task = (id: string, title: string): BoardTask =>
  ({ id, title, project: "p1" }) as unknown as BoardTask;
const doc = (id: string, title: string): BoardDoc =>
  ({ id, title, projects: ["p2"] }) as unknown as BoardDoc;

describe("taskToItem / docToItem", () => {
  it("任务→导航候选：kind=task，path 指向该项目看板", () => {
    const it0 = taskToItem(task("t1", "修 bug"));
    expect(it0.kind).toBe("task");
    expect(it0.label).toBe("修 bug");
    expect(it0.path).toContain("open=p1");
    expect(it0.path).toContain("tab=board");
  });
  it("文档→导航候选：kind=doc，path 定位到该文档", () => {
    const it0 = docToItem(doc("d1", "设计稿"));
    expect(it0.kind).toBe("doc");
    expect(it0.path).toContain("open=p2");
    expect(it0.path).toContain("tab=docs");
    expect(it0.path).toContain("doc=d1");
  });
});

describe("buildItems", () => {
  const sessions = [
    makeSession("a", "alpha", "fix login", "2024-01-03T00:00:00Z"),
    makeSession("b", "beta", "add cache", "2024-01-02T00:00:00Z"),
  ];
  const tasks = [task("t1", "fix pipeline"), task("t2", "unrelated")];
  const docs = [doc("d1", "fix notes")];

  it("空 query → 仅最近会话（kind 全为 session）", () => {
    const items = buildItems("", sessions, tasks, docs, 20);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.kind === "session")).toBe(true);
  });

  it("有 query → 会话 + 任务 + 文档 混合（按标题匹配）", () => {
    const items = buildItems("fix", sessions, tasks, docs, 20);
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("session"); // "fix login" 命中
    expect(kinds).toContain("task"); // "fix pipeline" 命中
    expect(kinds).toContain("doc"); // "fix notes" 命中
    // 会话在前
    expect(items[0].kind).toBe("session");
    // "unrelated" 任务不应命中
    expect(items.some((i) => i.kind === "task" && i.label === "unrelated")).toBe(false);
  });
});

describe("sessionToItem", () => {
  it("label 包含 project_name 和 first_prompt 摘要", () => {
    const s = makeSession("x", "myapp", "implement the thing", "2024-01-01T00:00:00Z");
    const item = sessionToItem(s);
    expect(item.session).toBe(s);
    expect(item.label).toContain("myapp");
    expect(item.label).toContain("implement the thing");
  });

  it("first_prompt 超过 60 字符时截断并加省略号", () => {
    const longPrompt = "a".repeat(80);
    const s = makeSession("y", "proj", longPrompt, "2024-01-01T00:00:00Z");
    const item = sessionToItem(s);
    // label 中的摘要部分应包含省略号
    expect(item.label).toContain("…");
    // 摘要本身不超过 61 字符（60 + "…"）
    const summary = item.label.split(" — ")[1];
    expect(summary.length).toBeLessThanOrEqual(61);
  });

  it("first_prompt 恰好 60 字符时不加省略号", () => {
    const prompt = "b".repeat(60);
    const s = makeSession("z", "proj", prompt, "2024-01-01T00:00:00Z");
    const item = sessionToItem(s);
    expect(item.label).not.toContain("…");
  });
});

describe("parsePrefix", () => {
  it("无前缀 → all，query 为原文", () => {
    expect(parsePrefix("hello")).toEqual({ category: "all", query: "hello" });
    expect(parsePrefix("")).toEqual({ category: "all", query: "" });
  });
  it("识别 s /p /d /t /m 前缀并剥离", () => {
    expect(parsePrefix("p board")).toEqual({ category: "project", query: "board" });
    expect(parsePrefix("m 偏好")).toEqual({ category: "memory", query: "偏好" });
    expect(parsePrefix("s ")).toEqual({ category: "session", query: "" });
  });
  it("单字母无空格不算前缀", () => {
    expect(parsePrefix("s")).toEqual({ category: "all", query: "s" });
  });
});

describe("formatInput", () => {
  it("all 无前缀，其它类别拼前缀", () => {
    expect(formatInput("all", "hi")).toBe("hi");
    expect(formatInput("project", "board")).toBe("p board");
    expect(formatInput("memory", "")).toBe("m ");
  });
  it("parsePrefix ∘ formatInput 往返一致", () => {
    expect(parsePrefix(formatInput("task", "urgent"))).toEqual({ category: "task", query: "urgent" });
  });
});

const proj = (id: string, name: string): BoardProject =>
  ({ id, name }) as unknown as BoardProject;
const mem = (id: string, content: string): Memory =>
  ({ id, content }) as unknown as Memory;

describe("projectToItem", () => {
  it("kind=project，path 指向项目工作台总览", () => {
    const it0 = projectToItem(proj("p1", "看板"));
    expect(it0.kind).toBe("project");
    expect(it0.label).toBe("看板");
    expect(it0.path).toContain("open=p1");
    expect(it0.path).toContain("tab=overview");
  });
});

describe("memoryLabel / memoryToItem", () => {
  it("label 取正文首行，超 60 截断加省略号", () => {
    expect(memoryLabel(mem("m1", "第一行\n第二行"))).toBe("第一行");
    expect(memoryLabel(mem("m2", "x".repeat(80)))).toBe("x".repeat(60) + "…");
  });
  it("kind=memory，path 为 /memory?open=<id>", () => {
    const it0 = memoryToItem(mem("m3", "偏好：深色主题"));
    expect(it0.kind).toBe("memory");
    expect(it0.path).toBe("/memory?open=m3");
    expect(it0.label).toBe("偏好：深色主题");
  });
});

describe("filterProjects / filterMemories", () => {
  it("按名称/正文忽略大小写过滤；空查询返回空", () => {
    const projects = [proj("p1", "Alpha"), proj("p2", "beta")];
    expect(filterProjects(projects, "alp").map((p) => p.id)).toEqual(["p1"]);
    expect(filterProjects(projects, "")).toEqual([]);
    const memories = [mem("m1", "深色主题"), mem("m2", "浅色")];
    expect(filterMemories(memories, "深色").map((m) => m.id)).toEqual(["m1"]);
    expect(filterMemories(memories, "  ")).toEqual([]);
  });
});
