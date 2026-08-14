import { describe, it, expect } from "vitest";
import { orderedTaskGroups } from "../list-grouping";
import type { BoardTask, BoardState } from "@/types/board";

const st = (id: string, sort_order: number): BoardState =>
  ({ id, name: id, color: "#000", category: "pending", sort_order } as unknown as BoardState);
const tk = (id: string, state: string, rank: number, archived = false): BoardTask =>
  ({ id, title: id, state, rank, archived, priority: "none" } as unknown as BoardTask);

describe("orderedTaskGroups", () => {
  const states = [st("b", 1), st("a", 0)]; // 乱序，函数应按 sort_order 排
  it("按 state.sort_order 排组", () => {
    const g = orderedTaskGroups([], states);
    expect(g.map((x) => x.state.id)).toEqual(["a", "b"]);
  });
  it("组内按 rank 升序、按 state 归组", () => {
    const tasks = [tk("t2", "a", 2), tk("t1", "a", 1), tk("t3", "b", 0)];
    const g = orderedTaskGroups(tasks, states);
    expect(g[0].tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(g[1].tasks.map((t) => t.id)).toEqual(["t3"]);
  });
  it("默认排除 archived；showArchived=true 时包含", () => {
    const tasks = [tk("t1", "a", 1), tk("t2", "a", 2, true)];
    expect(orderedTaskGroups(tasks, states)[0].tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(orderedTaskGroups(tasks, states, true)[0].tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
  });
});
