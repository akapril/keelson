// @vitest-environment jsdom
// 注意：.test.tsx 文件必须在文件头写 // @vitest-environment jsdom，
// 否则会静默用 node 环境失败（vitest.config.ts 默认 environment 为 "node"）。
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock Tauri APIs（SessionCard 的依赖链会触发 Tauri invoke）
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock IPC（SessionCard 内部不直接调 ipc，但防止依赖链错误）
vi.mock("@/lib/tauri/ipc", () => ({
  ipc: {
    openPath: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock store（避免 Zustand/PocketBase 副作用）
vi.mock("../../store/session-meta", () => ({
  useSessionMetaStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      favorites: new Set(),
      hidden: new Set(),
      customNames: new Map(),
      toggleFavorite: vi.fn(),
      toggleHidden: vi.fn(),
      setCustomName: vi.fn(),
    }),
  ),
}));

// Mock 子对话框（不测对话框本身）
vi.mock("../../features/board/CreateTaskFromSessionDialog", () => ({
  CreateTaskFromSessionDialog: () => null,
}));
vi.mock("../../features/memory/MemoryReviewDialog", () => ({
  MemoryReviewDialog: () => null,
}));
vi.mock("@/components/prompt-dialog", () => ({
  PromptDialog: () => null,
}));

import i18n from "../index";
import { SessionCard } from "@/features/sessions/SessionCard";
import type { Session } from "@/types/session";

// 构造最小 Session 测试数据
const mockSession: Session = {
  session_id: "test-session-id-001",
  project_name: "test-project",
  project_path: "/home/user/test",
  provider: "claude-cli",
  message_count: 42,
  updated_at: new Date(Date.now() - 30_000).toISOString(), // 30 秒前 → 刚刚
  last_prompt: "这是一条测试提示词",
  first_prompt: "这是第一条提示词",
  created_at: new Date().toISOString(),
  user_messages: [],
  total_tokens: 0,
};

function renderCard() {
  render(
    <SessionCard
      session={mockSession}
      selected={false}
      onSelect={vi.fn()}
    />,
  );
}

describe("SessionCard i18n – sessions 命名空间", () => {
  afterEach(async () => {
    cleanup();
    // 复原为中文，避免污染后续用例
    await i18n.changeLanguage("zh");
  });

  it("默认中文：建任务按钮文本为「建任务」", async () => {
    await i18n.changeLanguage("zh");
    renderCard();
    expect(screen.getAllByText("建任务").length).toBeGreaterThan(0);
  });

  it("默认中文：恢复按钮文本为「恢复」", async () => {
    await i18n.changeLanguage("zh");
    renderCard();
    expect(screen.getAllByText("恢复").length).toBeGreaterThan(0);
  });

  it("默认中文：消息计数包含「条消息」", async () => {
    await i18n.changeLanguage("zh");
    renderCard();
    expect(screen.getByText("42 条消息")).toBeInTheDocument();
  });

  it("切换英文：建任务按钮文本为「Create task」", async () => {
    await i18n.changeLanguage("en");
    renderCard();
    expect(screen.getAllByText("Create task").length).toBeGreaterThan(0);
  });

  it("切换英文：恢复按钮文本为「Restore」", async () => {
    await i18n.changeLanguage("en");
    renderCard();
    expect(screen.getAllByText("Restore").length).toBeGreaterThan(0);
  });

  it("切换英文：消息计数包含「messages」", async () => {
    await i18n.changeLanguage("en");
    renderCard();
    expect(screen.getByText("42 messages")).toBeInTheDocument();
  });

  it("英文键值非空（sessions.card.createTask 有翻译）", () => {
    const val = i18n.t("card.createTask", { ns: "sessions", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("card.createTask");
  });

  it("英文键值非空（sessions.card.restore 有翻译）", () => {
    const val = i18n.t("card.restore", { ns: "sessions", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("card.restore");
  });

  it("英文键值非空（sessions.list.modeSearch 有翻译）", () => {
    const val = i18n.t("list.modeSearch", { ns: "sessions", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("list.modeSearch");
  });

  it("英文键值非空（sessions.restore.title 有翻译）", () => {
    const val = i18n.t("restore.title", { ns: "sessions", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("restore.title");
  });

  it("中文插值正确（sessions.card.messageCount）", () => {
    const val = i18n.t("card.messageCount", { ns: "sessions", lng: "zh", n: 10 });
    expect(val).toBe("10 条消息");
  });

  it("英文插值正确（sessions.card.messageCount）", () => {
    const val = i18n.t("card.messageCount", { ns: "sessions", lng: "en", n: 10 });
    expect(val).toBe("10 messages");
  });
});
