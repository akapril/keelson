import { describe, it, expect } from "vitest";
import { taskMatchesFilter, isFilterActive, EMPTY_FILTER } from "./task-filter";
import type { BoardTask } from "@/types/board";

function task(p: Partial<BoardTask>): BoardTask {
  return {
    id: "t",
    project: "p",
    state: "s",
    title: "",
    priority: "none",
    created_by: "u",
    created: "",
    updated: "",
    ...p,
  };
}

describe("taskMatchesFilter", () => {
  it("空筛选全通过", () => {
    expect(taskMatchesFilter(task({ title: "任意" }), EMPTY_FILTER)).toBe(true);
  });

  it("文本匹配标题或描述(大小写不敏感)", () => {
    const t = task({ title: "登录流程", description: "OAuth 回调" });
    expect(taskMatchesFilter(t, { ...EMPTY_FILTER, query: "登录" })).toBe(true);
    expect(taskMatchesFilter(t, { ...EMPTY_FILTER, query: "oauth" })).toBe(true);
    expect(taskMatchesFilter(t, { ...EMPTY_FILTER, query: "无关" })).toBe(false);
  });

  it("标签 OR 命中", () => {
    const t = task({ labels: ["l1", "l3"] });
    expect(taskMatchesFilter(t, { ...EMPTY_FILTER, labels: ["l3"] })).toBe(true);
    expect(taskMatchesFilter(t, { ...EMPTY_FILTER, labels: ["l2", "l3"] })).toBe(true);
    expect(taskMatchesFilter(t, { ...EMPTY_FILTER, labels: ["l2"] })).toBe(false);
  });

  it("优先级精确", () => {
    const t = task({ priority: "high" });
    expect(taskMatchesFilter(t, { ...EMPTY_FILTER, priority: "high" })).toBe(true);
    expect(taskMatchesFilter(t, { ...EMPTY_FILTER, priority: "low" })).toBe(false);
  });

  it("多条件 AND", () => {
    const t = task({ title: "改登录", priority: "high", labels: ["l1"] });
    expect(taskMatchesFilter(t, { query: "登录", labels: ["l1"], priority: "high" })).toBe(true);
    expect(taskMatchesFilter(t, { query: "登录", labels: ["l1"], priority: "low" })).toBe(false);
  });

  it("isFilterActive", () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, query: "x" })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, labels: ["l"] })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, priority: "high" })).toBe(true);
  });
});
