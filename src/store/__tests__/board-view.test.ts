// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useBoardViewStore } from "@/store/board-view";
import { EMPTY_FILTER } from "@/features/board/task-filter";

describe("board-view store 当前视图配置（Issues 视图深化）", () => {
  beforeEach(() => {
    useBoardViewStore.setState({ viewType: "kanban", filter: EMPTY_FILTER, swimlane: "none" });
  });

  it("setViewType 改视图类型", () => {
    useBoardViewStore.getState().setViewType("timeline");
    expect(useBoardViewStore.getState().viewType).toBe("timeline");
  });

  it("setSwimlane 改泳道分组", () => {
    useBoardViewStore.getState().setSwimlane("priority");
    expect(useBoardViewStore.getState().swimlane).toBe("priority");
  });

  it("applyConfig 灌入整套配置", () => {
    const cfg = { viewType: "list" as const, filter: { query: "x", labels: ["l1"], priority: "high" as const }, swimlane: "label" as const };
    useBoardViewStore.getState().applyConfig(cfg);
    const s = useBoardViewStore.getState();
    expect(s.viewType).toBe("list");
    expect(s.filter.query).toBe("x");
    expect(s.swimlane).toBe("label");
  });

  it("resetForProject 只重置 filter/swimlane，不动 viewType", () => {
    useBoardViewStore.getState().applyConfig({ viewType: "timeline", filter: { query: "y", labels: [], priority: null }, swimlane: "agent" });
    useBoardViewStore.getState().resetForProject();
    const s = useBoardViewStore.getState();
    expect(s.viewType).toBe("timeline"); // 视图类型保留
    expect(s.filter).toEqual(EMPTY_FILTER); // 筛选清空
    expect(s.swimlane).toBe("none"); // 泳道清空
  });
});
