// @vitest-environment jsdom
// localStorage 依赖 DOM 环境（默认 node 无 localStorage）。
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadCommands,
  addHistory,
  toggleFavorite,
  isFavorite,
  removeHistory,
  removeFavorite,
} from "../command-store";

const PROJ = "/tmp/proj-a";

describe("command-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("空/无记录时返回空集合", () => {
    expect(loadCommands(PROJ)).toEqual({ favorites: [], history: [] });
  });

  it("addHistory 置顶 + 按命令+cwd 去重", () => {
    addHistory(PROJ, { command: "npm run dev", cwd: "/tmp/proj-a" });
    addHistory(PROJ, { command: "npm test", cwd: "/tmp/proj-a" });
    // 再次记 dev（同 cwd）→ 去重后置顶，不新增
    const s = addHistory(PROJ, { command: "npm run dev", cwd: "/tmp/proj-a" });
    expect(s.history.map((h) => h.command)).toEqual(["npm run dev", "npm test"]);
  });

  it("命令相同但 cwd 不同视为两条", () => {
    addHistory(PROJ, { command: "ls" });
    const s = addHistory(PROJ, { command: "ls", cwd: "/other" });
    expect(s.history).toHaveLength(2);
  });

  it("历史上限 30，超出截断最旧", () => {
    for (let i = 0; i < 35; i++) addHistory(PROJ, { command: `cmd-${i}` });
    const s = loadCommands(PROJ);
    expect(s.history).toHaveLength(30);
    // 最近的在最前，最旧的(cmd-0..4)被挤出
    expect(s.history[0].command).toBe("cmd-34");
    expect(s.history.some((h) => h.command === "cmd-0")).toBe(false);
  });

  it("空命令不记历史", () => {
    const s = addHistory(PROJ, { command: "   " });
    expect(s.history).toHaveLength(0);
  });

  it("toggleFavorite 增删 + isFavorite", () => {
    const e = { command: "npm run build", cwd: "/tmp/proj-a" };
    expect(isFavorite(PROJ, e)).toBe(false);
    toggleFavorite(PROJ, e);
    expect(isFavorite(PROJ, e)).toBe(true);
    // 再次切换 → 移除
    toggleFavorite(PROJ, e);
    expect(isFavorite(PROJ, e)).toBe(false);
  });

  it("removeHistory / removeFavorite 精确删除对应条", () => {
    addHistory(PROJ, { command: "a" });
    addHistory(PROJ, { command: "b" });
    toggleFavorite(PROJ, { command: "f1" });
    toggleFavorite(PROJ, { command: "f2" });
    removeHistory(PROJ, { command: "a" });
    removeFavorite(PROJ, { command: "f1" });
    const s = loadCommands(PROJ);
    expect(s.history.map((h) => h.command)).toEqual(["b"]);
    expect(s.favorites.map((f) => f.command)).toEqual(["f2"]);
  });

  it("按项目隔离：不同 projectKey 互不影响", () => {
    addHistory(PROJ, { command: "x" });
    addHistory("/tmp/proj-b", { command: "y" });
    expect(loadCommands(PROJ).history.map((h) => h.command)).toEqual(["x"]);
    expect(loadCommands("/tmp/proj-b").history.map((h) => h.command)).toEqual(["y"]);
  });

  it("损坏 JSON → 空集合不抛", () => {
    localStorage.setItem("rework-cmds:/tmp/proj-a", "not json {{{");
    expect(loadCommands(PROJ)).toEqual({ favorites: [], history: [] });
  });
});
