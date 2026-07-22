import { describe, it, expect } from "vitest";
import type { CommitInfo } from "@/types/git";
import type { BoardTask } from "@/types/board";
import type { Session } from "@/types/session";
import {
  inWindow,
  dedupeCommits,
  filterCompletedInWindow,
  filterSessionsInWindow,
  buildReportMaterial,
  hasAnyMaterial,
  type ReportMaterial,
} from "./report-collect";

const SINCE = Date.parse("2026-07-20T00:00:00Z");
const UNTIL = Date.parse("2026-07-26T23:59:59Z");

// ── 最小工厂（只填被测字段，其余以合理占位补齐类型） ──
function commit(hash: string, subject = "s"): CommitInfo {
  return {
    hash,
    short: hash.slice(0, 7),
    subject,
    author: "a",
    committed_at: "2026-07-22T10:00:00Z",
    rework_session: null,
  };
}
function task(over: Partial<BoardTask>): BoardTask {
  return {
    id: "t",
    project: "p1",
    state: "s1",
    title: "任务",
    priority: "none",
    created_by: "u",
    created: "2026-07-22T00:00:00Z",
    updated: "2026-07-22T00:00:00Z",
    ...over,
  };
}
function session(over: Partial<Session>): Session {
  return {
    session_id: "sid",
    provider: "claude",
    project_path: "/r/p1",
    project_name: "p1",
    first_prompt: "做点什么",
    last_prompt: "",
    created_at: "2026-07-22T00:00:00Z",
    updated_at: "2026-07-22T00:00:00Z",
    message_count: 5,
    user_messages: [],
    total_tokens: 0,
    ...over,
  };
}

describe("inWindow", () => {
  it("窗口内/外/非法", () => {
    expect(inWindow("2026-07-22T10:00:00Z", SINCE, UNTIL)).toBe(true);
    expect(inWindow("2026-07-19T10:00:00Z", SINCE, UNTIL)).toBe(false);
    expect(inWindow("2026-07-30T10:00:00Z", SINCE, UNTIL)).toBe(false);
    expect(inWindow("", SINCE, UNTIL)).toBe(false);
    expect(inWindow("not-a-date", SINCE, UNTIL)).toBe(false);
  });
});

describe("dedupeCommits", () => {
  it("按 hash 去重，保留首次", () => {
    const out = dedupeCommits([commit("aaa", "1"), commit("bbb"), commit("aaa", "2")]);
    expect(out).toHaveLength(2);
    expect(out[0].subject).toBe("1"); // 保留首次
  });
});

describe("filterCompletedInWindow", () => {
  const done = new Set(["done"]);
  it("仅完成态且在窗口内", () => {
    const tasks = [
      task({ id: "a", state: "done", updated: "2026-07-22T00:00:00Z" }), // ✓
      task({ id: "b", state: "todo", updated: "2026-07-22T00:00:00Z" }), // 非完成态
      task({ id: "c", state: "done", updated: "2026-07-01T00:00:00Z" }), // 窗口外
    ];
    const out = filterCompletedInWindow(tasks, done, SINCE, UNTIL);
    expect(out.map((t) => t.id)).toEqual(["a"]);
  });
  it("归档的完成任务也计入", () => {
    const out = filterCompletedInWindow(
      [task({ id: "a", state: "done", archived: true })],
      done,
      SINCE,
      UNTIL,
    );
    expect(out).toHaveLength(1);
  });
});

describe("filterSessionsInWindow", () => {
  it("按 updated_at 过滤", () => {
    const out = filterSessionsInWindow(
      [
        session({ session_id: "in", updated_at: "2026-07-22T00:00:00Z" }),
        session({ session_id: "out", updated_at: "2026-06-01T00:00:00Z" }),
      ],
      SINCE,
      UNTIL,
    );
    expect(out.map((s) => s.session_id)).toEqual(["in"]);
  });
});

describe("buildReportMaterial / hasAnyMaterial", () => {
  const material: ReportMaterial = {
    rangeLabel: "本周（07-20 ~ 07-26）",
    commitGroups: [{ label: "rework", commits: [commit("aaaaaaa", "feat: x")] }],
    taskGroups: [{ label: "rework", tasks: [task({ title: "修 bug" })] }],
    sessionGroups: [{ label: "rework", sessions: [session({})] }],
  };

  it("拼装含三大节标题与计数", () => {
    const txt = buildReportMaterial(material);
    expect(txt).toContain("时间范围：本周");
    expect(txt).toContain("## Git 提交（1 条）");
    expect(txt).toContain("## 完成任务（1 个）");
    expect(txt).toContain("## AI 会话活动（1 个）");
    expect(txt).toContain("feat: x");
    expect(txt).toContain("修 bug");
  });

  it("hasAnyMaterial：有则真、全空则假", () => {
    expect(hasAnyMaterial(material)).toBe(true);
    expect(
      hasAnyMaterial({
        rangeLabel: "x",
        commitGroups: [],
        taskGroups: [],
        sessionGroups: [],
      }),
    ).toBe(false);
  });

  it("全空素材各节标注（无）", () => {
    const txt = buildReportMaterial({
      rangeLabel: "x",
      commitGroups: [],
      taskGroups: [],
      sessionGroups: [],
    });
    expect(txt).toContain("## Git 提交（0 条）");
    expect((txt.match(/（无）/g) ?? []).length).toBe(3);
  });
});
