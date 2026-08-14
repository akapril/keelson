// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useBoardViewStore } from "../board-view";

describe("board-view store", () => {
  beforeEach(() => {
    localStorage.clear();
    useBoardViewStore.setState({ view: "kanban" });
  });
  it("默认视图为 kanban", () => {
    expect(useBoardViewStore.getState().view).toBe("kanban");
  });
  it("setView 切换并持久化到 localStorage", () => {
    useBoardViewStore.getState().setView("list");
    expect(useBoardViewStore.getState().view).toBe("list");
    expect(localStorage.getItem("keelson:board-view")).toBe("list");
  });
});
