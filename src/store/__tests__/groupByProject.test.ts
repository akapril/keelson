import { describe, it, expect } from "vitest";
import { groupByProject, dedupeById } from "../sessions";
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

describe("dedupeById", () => {
  it("无重复时原样返回", () => {
    const list = [makeSession("a", "/p"), makeSession("b", "/p")];
    expect(dedupeById(list)).toHaveLength(2);
  });

  it("相同 session_id 去重，保留 updated_at 最新的一条", () => {
    const older = { ...makeSession("dup", "/p"), updated_at: "2024-01-01T00:00:00Z", message_count: 1 };
    const newer = { ...makeSession("dup", "/p"), updated_at: "2024-06-01T00:00:00Z", message_count: 9 };
    const out = dedupeById([older, newer]);
    expect(out).toHaveLength(1);
    expect(out[0].message_count).toBe(9); // 保留了较新的一条
  });

  it("去重后 id 唯一（避免 React key 冲突）", () => {
    const list = [makeSession("x", "/p"), makeSession("x", "/p"), makeSession("y", "/p")];
    const ids = dedupeById(list).map((s) => s.session_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(["x", "y"]);
  });
});
