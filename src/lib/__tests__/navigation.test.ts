import { describe, it, expect } from "vitest";
import { navGroups, flatNavItems } from "@/lib/navigation";

describe("navigation 三组结构（S5）", () => {
  it("恰好三组，顺序=工作/Agent团队/知识", () => {
    expect(navGroups.map((g) => g.labelKey)).toEqual([
      "nav.groupWork",
      "nav.groupAgentTeam",
      "nav.groupKnowledge",
    ]);
  });

  it("工作组顺序：总览→看板→会话→文档", () => {
    const work = navGroups.find((g) => g.labelKey === "nav.groupWork")!;
    expect(work.items.map((i) => i.url)).toEqual([
      "/dashboard",
      "/board?tab=board",
      "/sessions",
      "/docs",
    ]);
  });

  it("Agent 团队组含 Agents/运行时/Inbox", () => {
    const team = navGroups.find((g) => g.labelKey === "nav.groupAgentTeam")!;
    expect(team.items.map((i) => i.url)).toEqual(["/agents", "/processes", "/inbox"]);
  });

  it("知识组含成本(/usage)", () => {
    const know = navGroups.find((g) => g.labelKey === "nav.groupKnowledge")!;
    expect(know.items.map((i) => i.url)).toContain("/usage");
  });

  it("flatNavItems 含新增 Inbox 与成本项", () => {
    const urls = flatNavItems.map((i) => i.url);
    expect(urls).toContain("/inbox");
    expect(urls).toContain("/usage");
  });

  it("看板项标题键未被改名为任务", () => {
    const board = flatNavItems.find((i) => i.url === "/board?tab=board")!;
    expect(board.titleKey).toBe("nav.board.title");
  });
});
