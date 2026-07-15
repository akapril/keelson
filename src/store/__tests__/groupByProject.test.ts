import { describe, it, expect } from "vitest";
import { groupByProject } from "../sessions";
import type { Session } from "../../types/session";

/** 构造最小化测试用 Session（所有必填字段均填充默认值） */
function makeSession(session_id: string, project_path: string): Session {
  return {
    session_id,
    provider: "claude",
    project_path,
    project_name: project_path.split(/[\\/]/).filter(Boolean).at(-1) ?? project_path,
    first_prompt: "test prompt",
    last_prompt: "test prompt",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    message_count: 0,
    user_messages: [],
    total_tokens: 0,
  };
}

describe("groupByProject", () => {
  it("空数组返回空对象", () => {
    expect(groupByProject([])).toEqual({});
  });

  it("同一 project_path 的会话被分到同一组", () => {
    const sessions = [
      makeSession("a1", "/home/user/proj-a"),
      makeSession("a2", "/home/user/proj-a"),
      makeSession("b1", "/home/user/proj-b"),
    ];
    const groups = groupByProject(sessions);
    expect(Object.keys(groups)).toHaveLength(2);
    expect(groups["/home/user/proj-a"]).toHaveLength(2);
    expect(groups["/home/user/proj-b"]).toHaveLength(1);
  });

  it("每个 key 与对应会话的 project_path 一致", () => {
    const sessions = [
      makeSession("x1", "/workspace/foo"),
      makeSession("x2", "/workspace/bar"),
    ];
    const groups = groupByProject(sessions);
    for (const [key, list] of Object.entries(groups)) {
      for (const s of list) {
        expect(s.project_path).toBe(key);
      }
    }
  });

  it("单条会话独立成组", () => {
    const sessions = [makeSession("solo", "/only/path")];
    const groups = groupByProject(sessions);
    expect(groups["/only/path"]).toEqual(sessions);
  });
});
