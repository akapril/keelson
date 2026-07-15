// utils.test.ts — Spotlight 纯函数辅助测试
import { describe, it, expect } from "vitest";
import { recentSessions, filterSessions, sessionToItem } from "../utils";
import type { Session } from "../../../types/session";

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
