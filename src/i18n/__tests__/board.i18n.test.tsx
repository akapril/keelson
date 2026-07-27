// @vitest-environment jsdom
// 注意：.test.tsx 文件必须在文件头写 // @vitest-environment jsdom，
// 否则会静默用 node 环境失败（vitest.config.ts 默认 environment 为 "node"）。
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock Tauri APIs（TaskCard 的依赖链会触发 Tauri invoke）
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock dnd-kit（TaskCard 用到 useSortable）
vi.mock("@dnd-kit/sortable", () => ({
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  })),
}));

// Mock router（TaskCard 用到 useNavigate）
vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
}));

// Mock board store
vi.mock("@/store/board", () => ({
  useBoardStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      updateTask: vi.fn().mockResolvedValue(undefined),
      deleteTask: vi.fn().mockResolvedValue(undefined),
      moveTask: vi.fn().mockResolvedValue(undefined),
    }),
  ),
}));

// Mock cli-task-source（TaskCard 依赖）
vi.mock("../../features/board/cli-task-source", () => ({
  isCliSynced: vi.fn(() => false),
  toggleInject: vi.fn(() => false),
  getInjectSet: vi.fn(() => new Set()),
}));

// Mock markdown-preview（TaskCard 依赖）
vi.mock("@/lib/markdown-preview", () => ({
  stripMarkdown: vi.fn((s: string) => s),
}));

import i18n from "../index";
import { TaskCard } from "@/features/board/TaskCard";
import type { BoardTask, BoardLabel, BoardState } from "@/types/board";

// 构造最小 BoardTask 测试数据
const mockTask: BoardTask = {
  id: "test-task-id-001",
  project: "test-project-id",
  state: "state-todo",
  title: "测试任务标题",
  priority: "high",
  archived: false,
  labels: [],
  rank: 0,
  created_by: "user-1",
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
};

const mockLabels: BoardLabel[] = [];
const mockStates: BoardState[] = [
  { id: "state-todo", name: "待办", color: "#888", category: "pending", sort_order: 0,
    project: "test-project-id", created: new Date().toISOString(), updated: new Date().toISOString() },
];

function renderCard() {
  render(
    <TaskCard
      task={mockTask}
      labels={mockLabels}
      states={mockStates}
    />,
  );
}

describe("TaskCard i18n – board 命名空间", () => {
  afterEach(async () => {
    cleanup();
    // 复原为中文，避免污染后续用例
    await i18n.changeLanguage("zh");
  });

  it("默认中文：优先级徽章显示「高」", async () => {
    await i18n.changeLanguage("zh");
    renderCard();
    expect(screen.getByText("高")).toBeInTheDocument();
  });

  it("切换英文：优先级徽章显示「High」", async () => {
    await i18n.changeLanguage("en");
    renderCard();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("中文键值非空（board.meta.priority.high 有翻译）", () => {
    const val = i18n.t("meta.priority.high", { ns: "board", lng: "zh" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("meta.priority.high");
    expect(val).toBe("高");
  });

  it("英文键值非空（board.meta.priority.high 有翻译）", () => {
    const val = i18n.t("meta.priority.high", { ns: "board", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("meta.priority.high");
    expect(val).toBe("High");
  });

  it("中文优先级 none 为「无」", () => {
    const val = i18n.t("meta.priority.none", { ns: "board", lng: "zh" });
    expect(val).toBe("无");
  });

  it("英文优先级 none 为「None」", () => {
    const val = i18n.t("meta.priority.none", { ns: "board", lng: "en" });
    expect(val).toBe("None");
  });

  it("中文 task.archived 为「已归档」", () => {
    const val = i18n.t("task.archived", { ns: "board", lng: "zh" });
    expect(val).toBe("已归档");
  });

  it("英文 task.archived 为「Archived」", () => {
    const val = i18n.t("task.archived", { ns: "board", lng: "en" });
    expect(val).toBe("Archived");
  });

  it("中文 board.noStates 非空且非 key", () => {
    const val = i18n.t("board.noStates", { ns: "board", lng: "zh" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("board.noStates");
  });

  it("英文 board.noStates 非空且非 key", () => {
    const val = i18n.t("board.noStates", { ns: "board", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("board.noStates");
  });

  it("中文插值正确（batch.selectedCount）", () => {
    const val = i18n.t("batch.selectedCount", { ns: "board", lng: "zh", count: 3 });
    expect(val).toBe("已选 3 项");
  });

  it("英文插值正确（batch.selectedCount）", () => {
    const val = i18n.t("batch.selectedCount", { ns: "board", lng: "en", count: 3 });
    expect(val).toBe("3 selected");
  });

  it("中文 stateCategory.pending 为「待处理」", () => {
    const val = i18n.t("meta.stateCategory.pending", { ns: "board", lng: "zh" });
    expect(val).toBe("待处理");
  });

  it("英文 stateCategory.pending 为「Pending」", () => {
    const val = i18n.t("meta.stateCategory.pending", { ns: "board", lng: "en" });
    expect(val).toBe("Pending");
  });
});
