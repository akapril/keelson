import { describe, it, expect } from "vitest";
import { recentSessionsOf } from "@/lib/recent-sessions";
import type { Session } from "@/types/session";

// 造一条最小会话：只填参与过滤/排序的字段，其余给默认值。
function mk(id: string, projectPath: string, updatedAt: string): Session {
  return {
    session_id: id,
    provider: "claude",
    project_path: projectPath,
    project_name: "p",
    first_prompt: "",
    last_prompt: "",
    created_at: updatedAt,
    updated_at: updatedAt,
    message_count: 0,
    user_messages: [],
    total_tokens: 0,
  };
}

describe("recentSessionsOf", () => {
  const sessions: Session[] = [
    mk("a", "/repo/x", "2026-08-10T10:00:00Z"),
    mk("b", "/repo/x", "2026-08-12T09:00:00Z"),
    mk("c", "/repo/y", "2026-08-12T23:00:00Z"), // 别的项目，不应命中
    mk("d", "/repo/x", "2026-08-11T08:00:00Z"),
  ];

  it("repoPath 为空返回空数组", () => {
    expect(recentSessionsOf(sessions, undefined)).toEqual([]);
    expect(recentSessionsOf(sessions, "")).toEqual([]);
  });

  it("只取匹配 project_path 的会话", () => {
    const ids = recentSessionsOf(sessions, "/repo/x").map((s) => s.session_id);
    expect(ids).not.toContain("c");
    expect(ids).toEqual(["b", "d", "a"]); // 按 updated_at 倒序
  });

  it("无匹配返回空数组", () => {
    expect(recentSessionsOf(sessions, "/repo/none")).toEqual([]);
  });

  it("遵守 limit 上限", () => {
    expect(recentSessionsOf(sessions, "/repo/x", 2).map((s) => s.session_id)).toEqual(["b", "d"]);
  });

  it("不修改入参数组（sort 作用于副本）", () => {
    const before = sessions.map((s) => s.session_id);
    recentSessionsOf(sessions, "/repo/x");
    expect(sessions.map((s) => s.session_id)).toEqual(before);
  });
});
