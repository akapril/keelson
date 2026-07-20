// 活动流 store 测试：push 环形截断（上限 200，头插）+ 项目过滤合并去重。
import { describe, it, expect, beforeEach } from "vitest";
import { useActivityStore, ACTIVITY_MAX } from "./activity";
import { mergeEvents } from "../features/board/WorkspaceActivity";
import type { ActivityEvent } from "../types/activity";

// 构造一条活动事件（ts 递增便于断言顺序）
function ev(id: string, projectId?: string, ts = "2026-07-20T00:00:00.000Z"): ActivityEvent {
  return {
    id,
    ts,
    source: "mcp",
    provider: "",
    tool: "list_tasks",
    action: "read",
    summary: `活动 ${id}`,
    project_id: projectId,
    status: "ok",
  };
}

describe("useActivityStore.push", () => {
  beforeEach(() => {
    useActivityStore.getState().clear();
  });

  it("头插：最新事件在前", () => {
    useActivityStore.getState().push(ev("a"));
    useActivityStore.getState().push(ev("b"));
    const events = useActivityStore.getState().events;
    expect(events.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("环形截断：超过上限只保留最近 ACTIVITY_MAX 条", () => {
    for (let i = 0; i < ACTIVITY_MAX + 50; i++) {
      useActivityStore.getState().push(ev(`e${i}`));
    }
    const events = useActivityStore.getState().events;
    expect(events.length).toBe(ACTIVITY_MAX);
    // 头部为最后 push 的事件；被截断的是最早的
    expect(events[0].id).toBe(`e${ACTIVITY_MAX + 49}`);
    expect(events.some((e) => e.id === "e0")).toBe(false);
  });

  it("push 更新 pulse 时间戳", () => {
    expect(useActivityStore.getState().pulse).toBe(0);
    useActivityStore.getState().push(ev("x"));
    expect(useActivityStore.getState().pulse).toBeGreaterThan(0);
  });

  it("clear 清空 events 与 pulse", () => {
    useActivityStore.getState().push(ev("x"));
    useActivityStore.getState().clear();
    expect(useActivityStore.getState().events).toEqual([]);
    expect(useActivityStore.getState().pulse).toBe(0);
  });
});

describe("项目过滤 + mergeEvents 合并去重", () => {
  it("按 project_id 过滤内存流，仅命中本项目", () => {
    const all = [ev("a", "p1"), ev("b", "p2"), ev("c", "p1")];
    const live = all.filter((e) => e.project_id === "p1");
    expect(live.map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("持久历史 + 实时流按 id 去重、按 ts 倒序", () => {
    const persisted = [
      ev("p-old", "p1", "2026-07-20T01:00:00.000Z"),
      ev("shared", "p1", "2026-07-20T02:00:00.000Z"),
    ];
    // 实时流含一条与持久重复的 id（echo）+ 一条更新的
    const live = [
      ev("shared", "p1", "2026-07-20T02:00:00.000Z"),
      ev("live-new", "p1", "2026-07-20T03:00:00.000Z"),
    ];
    const merged = mergeEvents(persisted, live);
    // 去重：shared 只出现一次
    expect(merged.filter((e) => e.id === "shared").length).toBe(1);
    // 倒序：最新 ts 在前
    expect(merged.map((e) => e.id)).toEqual(["live-new", "shared", "p-old"]);
  });
});
