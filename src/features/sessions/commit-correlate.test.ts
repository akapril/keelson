import { describe, it, expect } from "vitest";
import { commitLinkedSessions } from "./commit-correlate";
import type { CommitInfo } from "@/types/git";
import type { Session } from "@/types/session";

function sess(id: string, created: string, updated: string): Session {
  return {
    session_id: id,
    provider: "claude",
    project_path: "/p/a",
    project_name: "a",
    first_prompt: "",
    last_prompt: "",
    created_at: created,
    updated_at: updated,
    message_count: 0,
    user_messages: [],
    total_tokens: 0,
  };
}

function commit(at: string, trailer: string | null): CommitInfo {
  return {
    hash: "h",
    short: "h",
    subject: "s",
    author: "a",
    committed_at: at,
    keelson_session: trailer,
  };
}

describe("commitLinkedSessions", () => {
  const s1 = sess("s1", "2026-07-18T10:00:00Z", "2026-07-18T11:00:00Z");
  const s2 = sess("s2", "2026-07-19T10:00:00Z", "2026-07-19T11:00:00Z");

  it("trailer 命中已加载会话 → 仅返回该会话(精确)", () => {
    const out = commitLinkedSessions(commit("2026-07-30T00:00:00Z", "s2"), [s1, s2]);
    expect(out).toEqual([{ session: s2, kind: "trailer" }]);
  });

  it("无 trailer → 时间窗内会话(可能相关)", () => {
    // 11:30 在 s1 的 [10:00, 11:00+4h] 内
    const out = commitLinkedSessions(commit("2026-07-18T11:30:00Z", null), [s1, s2]);
    expect(out).toEqual([{ session: s1, kind: "time" }]);
  });

  it("窗外 → 空", () => {
    // 早于 s1.created、且不在 s2 窗
    const out = commitLinkedSessions(commit("2026-07-18T08:00:00Z", null), [s1, s2]);
    expect(out).toEqual([]);
  });

  it("时间解析失败 → 空", () => {
    expect(commitLinkedSessions(commit("not-a-date", null), [s1, s2])).toEqual([]);
  });

  it("trailer 指向未加载会话 → 空(不降级为时间窗)", () => {
    // trailer=ghost 不在列表；即便时间落 s1 窗内，也不把精确降级成"可能相关"
    const out = commitLinkedSessions(commit("2026-07-18T10:30:00Z", "ghost"), [s1, s2]);
    expect(out).toEqual([]);
  });
});
