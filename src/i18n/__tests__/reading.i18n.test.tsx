// @vitest-environment jsdom
// 注意：.test.tsx 文件必须在文件头写 // @vitest-environment jsdom，
// 否则会静默用 node 环境失败（vitest.config.ts 默认 environment 为 "node"）。
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock Tauri APIs（ReadingPage 依赖链会触发 Tauri invoke）
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock reading store（避免 PocketBase 副作用）
// 使用 vi.hoisted 确保 mockStoreState 在 vi.mock 提升后仍可访问
const { mockUseReadingStore } = vi.hoisted(() => {
  const mockStoreState = {
    items: [] as unknown[],
    loading: false,
    error: null as string | null,
    addItem: vi.fn().mockResolvedValue(undefined),
    updateItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  };
  const hook = vi.fn((selector: (s: typeof mockStoreState) => unknown) =>
    selector(mockStoreState),
  );
  (hook as unknown as { getState: () => typeof mockStoreState }).getState = () => mockStoreState;
  return { mockUseReadingStore: hook };
});

vi.mock("@/store/reading", () => ({
  useReadingStore: mockUseReadingStore,
}));

// Mock reading summary job store
vi.mock("../../features/reading/reading-summary-job", () => ({
  useReadingSummaryJob: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ pending: new Set(), start: vi.fn() }),
  ),
}));

import i18n from "../index";
import ReadingPage from "@/features/reading/ReadingPage";

function renderPage() {
  render(<ReadingPage />);
}

describe("ReadingPage i18n – reading 命名空间", () => {
  afterEach(async () => {
    cleanup();
    // 复原为中文，避免污染后续用例
    await i18n.changeLanguage("zh");
  });

  it("默认中文：页面标题为「阅读」", async () => {
    await i18n.changeLanguage("zh");
    renderPage();
    expect(screen.getByRole("heading", { name: "阅读" })).toBeInTheDocument();
  });

  it("默认中文：添加按钮文本为「添加」", async () => {
    await i18n.changeLanguage("zh");
    renderPage();
    expect(screen.getByRole("button", { name: /添加/ })).toBeInTheDocument();
  });

  it("默认中文：搜索框 aria-label 为「搜索」", async () => {
    await i18n.changeLanguage("zh");
    renderPage();
    expect(screen.getByRole("textbox", { name: "搜索" })).toBeInTheDocument();
  });

  it("默认中文：空状态提示为「暂无阅读条目」", async () => {
    await i18n.changeLanguage("zh");
    renderPage();
    expect(screen.getByText("暂无阅读条目")).toBeInTheDocument();
  });

  it("切换英文：页面标题为「Reading」", async () => {
    await i18n.changeLanguage("en");
    renderPage();
    expect(screen.getByRole("heading", { name: "Reading" })).toBeInTheDocument();
  });

  it("切换英文：添加按钮文本为「Add」", async () => {
    await i18n.changeLanguage("en");
    renderPage();
    expect(screen.getByRole("button", { name: /Add/ })).toBeInTheDocument();
  });

  it("切换英文：搜索框 aria-label 为「Search」", async () => {
    await i18n.changeLanguage("en");
    renderPage();
    expect(screen.getByRole("textbox", { name: "Search" })).toBeInTheDocument();
  });

  it("切换英文：空状态提示为「No reading items yet」", async () => {
    await i18n.changeLanguage("en");
    renderPage();
    expect(screen.getByText("No reading items yet")).toBeInTheDocument();
  });

  it("英文键值非空（reading.page.title 有翻译）", () => {
    const val = i18n.t("page.title", { ns: "reading", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("page.title");
  });

  it("英文键值非空（reading.filter.all 有翻译）", () => {
    const val = i18n.t("filter.all", { ns: "reading", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("filter.all");
  });

  it("英文键值非空（reading.row.createTask 有翻译）", () => {
    const val = i18n.t("row.createTask", { ns: "reading", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("row.createTask");
  });

  it("英文键值非空（reading.detail.keyPoints 有翻译）", () => {
    const val = i18n.t("detail.keyPoints", { ns: "reading", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("detail.keyPoints");
  });

  it("中文插值正确（reading.toast.updateFailed）", () => {
    const val = i18n.t("toast.updateFailed", { ns: "reading", lng: "zh", msg: "网络错误" });
    expect(val).toBe("更新失败：网络错误");
  });

  it("英文插值正确（reading.toast.updateFailed）", () => {
    const val = i18n.t("toast.updateFailed", { ns: "reading", lng: "en", msg: "network error" });
    expect(val).toBe("Update failed: network error");
  });

  it("中文插值正确（reading.toast.summarizeDone）", () => {
    const val = i18n.t("toast.summarizeDone", { ns: "reading", lng: "zh", title: "测试文章" });
    expect(val).toBe("「测试文章」摘要完成");
  });

  it("英文插值正确（reading.toast.summarizeDone）", () => {
    const val = i18n.t("toast.summarizeDone", { ns: "reading", lng: "en", title: "Test Article" });
    expect(val).toBe('"Test Article" summarized');
  });

  it("中文插值正确（reading.section.pinned）", () => {
    const val = i18n.t("section.pinned", { ns: "reading", lng: "zh", count: 3 });
    expect(val).toBe("📌 置顶（3）");
  });

  it("英文插值正确（reading.section.pinned）", () => {
    const val = i18n.t("section.pinned", { ns: "reading", lng: "en", count: 3 });
    expect(val).toBe("📌 Pinned (3)");
  });

  it("中文插值正确（reading.row.readingMinutes）", () => {
    const val = i18n.t("row.readingMinutes", { ns: "reading", lng: "zh", n: 5 });
    expect(val).toBe("· 约 5 分钟");
  });

  it("英文插值正确（reading.row.readingMinutes）", () => {
    const val = i18n.t("row.readingMinutes", { ns: "reading", lng: "en", n: 5 });
    expect(val).toBe("· ~5 min");
  });

  // sentinel 路径端到端：中文模式 summarizeFailed {{msg}} 插值含中文错误文本
  it("中文模式：toast.summarizeFailed + summarizeError.noLink 插值含中文", () => {
    const errMsg = i18n.t("summarizeError.noLink", { ns: "reading", lng: "zh" });
    const val = i18n.t("toast.summarizeFailed", { ns: "reading", lng: "zh", title: "X", msg: errMsg });
    expect(val).toContain("该条目无链接");
    expect(val).toContain("X");
  });

  // sentinel 路径端到端：英文模式 summarizeFailed {{msg}} 插值含英文错误文本
  it("英文模式：toast.summarizeFailed + summarizeError.noLink 插值含英文", () => {
    const errMsg = i18n.t("summarizeError.noLink", { ns: "reading", lng: "en" });
    const val = i18n.t("toast.summarizeFailed", { ns: "reading", lng: "en", title: "X", msg: errMsg });
    expect(val).toContain("no link");
    expect(val).toContain("X");
  });

  // summarizeError 键在两种语言下均存在且非 fallback 键名
  it("中文：summarizeError.noContent 有翻译", () => {
    const val = i18n.t("summarizeError.noContent", { ns: "reading", lng: "zh" });
    expect(val).not.toBe("summarizeError.noContent");
    expect(val).toBeTruthy();
  });

  it("英文：summarizeError.parseFailed 有翻译", () => {
    const val = i18n.t("summarizeError.parseFailed", { ns: "reading", lng: "en" });
    expect(val).not.toBe("summarizeError.parseFailed");
    expect(val).toBeTruthy();
  });
});
