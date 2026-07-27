// @vitest-environment jsdom
// 注意：.test.tsx 文件必须在文件头写 // @vitest-environment jsdom，
// 否则会静默用 node 环境失败（vitest.config.ts 默认 environment 为 "node"）。
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock Tauri APIs（CalendarPage 依赖链会触发 Tauri invoke）
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock router（CalendarPage 用到 useNavigate）
vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
}));

// Mock calendar store（避免 PocketBase 副作用）
// CalendarPage 还会调用 useCalendarStore.getState()（Zustand 静态方法），需一并 mock
// 使用 vi.hoisted 确保变量在 vi.mock 提升后仍可访问
const { mockUseCalendarStore } = vi.hoisted(() => {
  const mockStoreState = {
    events: [] as unknown[],
    loading: false,
    error: null as string | null,
    addEvent: vi.fn().mockResolvedValue(undefined),
    updateEvent: vi.fn().mockResolvedValue(undefined),
    removeEvent: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  };
  const hook = vi.fn((selector: (s: typeof mockStoreState) => unknown) =>
    selector(mockStoreState),
  );
  (hook as unknown as { getState: () => typeof mockStoreState }).getState = () => mockStoreState;
  return { mockUseCalendarStore: hook };
});

vi.mock("@/store/calendar", () => ({
  useCalendarStore: mockUseCalendarStore,
}));

// Mock PocketBase board helpers（CalendarPage 拉取 dueTasks / projects）
vi.mock("@/lib/pb/board", () => ({
  listDueTasks: vi.fn().mockResolvedValue([]),
  listProjects: vi.fn().mockResolvedValue([]),
  updateTaskDueDate: vi.fn().mockResolvedValue(undefined),
}));

import i18n from "../index";
import CalendarPage from "@/features/calendar/CalendarPage";

function renderPage() {
  render(<CalendarPage />);
}

describe("CalendarPage i18n – calendar 命名空间", () => {
  afterEach(async () => {
    cleanup();
    // 复原为中文，避免污染后续用例
    await i18n.changeLanguage("zh");
  });

  it("默认中文：导航按钮包含「今天」", async () => {
    await i18n.changeLanguage("zh");
    renderPage();
    expect(screen.getByText("今天")).toBeInTheDocument();
  });

  it("默认中文：新建按钮文本为「新建」", async () => {
    await i18n.changeLanguage("zh");
    renderPage();
    expect(screen.getByText("新建")).toBeInTheDocument();
  });

  it("默认中文：星期表头包含「日」与「六」", async () => {
    await i18n.changeLanguage("zh");
    renderPage();
    expect(screen.getByText("日")).toBeInTheDocument();
    expect(screen.getByText("六")).toBeInTheDocument();
  });

  it("切换英文：导航按钮文本为「Today」", async () => {
    await i18n.changeLanguage("en");
    renderPage();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("切换英文：新建按钮文本为「New」", async () => {
    await i18n.changeLanguage("en");
    renderPage();
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("切换英文：星期表头包含「Sun」与「Sat」", async () => {
    await i18n.changeLanguage("en");
    renderPage();
    expect(screen.getByText("Sun")).toBeInTheDocument();
    expect(screen.getByText("Sat")).toBeInTheDocument();
  });

  it("切换英文：aria-label 上个月/下个月为英文", async () => {
    await i18n.changeLanguage("en");
    renderPage();
    expect(screen.getByLabelText("Previous month")).toBeInTheDocument();
    expect(screen.getByLabelText("Next month")).toBeInTheDocument();
  });

  it("中文键值非空（calendar.page.today 有翻译）", () => {
    const val = i18n.t("page.today", { ns: "calendar", lng: "zh" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("page.today");
  });

  it("英文键值非空（calendar.page.today 有翻译）", () => {
    const val = i18n.t("page.today", { ns: "calendar", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("page.today");
  });

  it("英文键值非空（calendar.dialog.titleCreate 有翻译）", () => {
    const val = i18n.t("dialog.titleCreate", { ns: "calendar", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("dialog.titleCreate");
  });

  it("英文键值非空（calendar.repeat.none 有翻译）", () => {
    const val = i18n.t("repeat.none", { ns: "calendar", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("repeat.none");
  });

  it("中文插值正确（calendar.toast.deleteError）", () => {
    const val = i18n.t("toast.deleteError", { ns: "calendar", lng: "zh", msg: "连接超时" });
    expect(val).toBe("删除失败：连接超时");
  });

  it("英文插值正确（calendar.toast.deleteError）", () => {
    const val = i18n.t("toast.deleteError", { ns: "calendar", lng: "en", msg: "timeout" });
    expect(val).toBe("Delete failed: timeout");
  });

  it("weekdays 数组长度为 7（zh）", () => {
    const arr = i18n.t("page.weekdays", { ns: "calendar", lng: "zh", returnObjects: true }) as string[];
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(7);
  });

  it("weekdays 数组长度为 7（en）", () => {
    const arr = i18n.t("page.weekdays", { ns: "calendar", lng: "en", returnObjects: true }) as string[];
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(7);
  });
});
