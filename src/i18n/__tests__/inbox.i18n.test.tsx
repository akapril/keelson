// @vitest-environment jsdom
// 注意：.test.tsx 文件必须在文件头写 // @vitest-environment jsdom，
// 否则会静默用 node 环境失败（vitest.config.ts 默认 environment 为 "node"）。
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock Tauri APIs（i18n 初始化时会触发 set_locale invoke）
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock react-router-dom（InboxPage 调用 useNavigate）
vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
}));

// Mock notifications store（避免 PocketBase 副作用）
vi.mock("../../store/notifications", () => ({
  useNotificationsStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      items: [],
      loading: false,
      load: vi.fn().mockResolvedValue(undefined),
      markRead: vi.fn().mockResolvedValue(undefined),
      markManyRead: vi.fn().mockResolvedValue(undefined),
      removeMany: vi.fn().mockResolvedValue(undefined),
    }),
  ),
}));

// Mock notification-prefs store
vi.mock("../../store/notification-prefs", () => ({
  useNotifPrefsStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ prefs: {} }),
  ),
}));

import i18n from "../index";
import InboxPage from "@/pages/inbox";

function renderInbox() {
  render(<InboxPage />);
}

describe("InboxPage i18n – inbox 命名空间", () => {
  afterEach(async () => {
    cleanup();
    // 复原为中文，避免污染后续用例
    await i18n.changeLanguage("zh");
  });

  it("默认中文：页面标题为「收件箱」", async () => {
    await i18n.changeLanguage("zh");
    renderInbox();
    expect(screen.getByText("收件箱")).toBeInTheDocument();
  });

  it("默认中文：副标题包含「批量处理」", async () => {
    await i18n.changeLanguage("zh");
    renderInbox();
    expect(screen.getByText(/批量处理/)).toBeInTheDocument();
  });

  it("默认中文：过滤按钮为「只看未读」", async () => {
    await i18n.changeLanguage("zh");
    renderInbox();
    expect(screen.getByText("只看未读")).toBeInTheDocument();
  });

  it("默认中文：全选 checkbox label 为「全选」", async () => {
    await i18n.changeLanguage("zh");
    renderInbox();
    expect(screen.getByText("全选")).toBeInTheDocument();
  });

  it("默认中文：标记已读按钮为「标记已读」", async () => {
    await i18n.changeLanguage("zh");
    renderInbox();
    expect(screen.getByText("标记已读")).toBeInTheDocument();
  });

  it("默认中文：删除按钮为「删除」（来自 common）", async () => {
    await i18n.changeLanguage("zh");
    renderInbox();
    expect(screen.getByText("删除")).toBeInTheDocument();
  });

  it("默认中文：空状态文案为「暂无通知」", async () => {
    await i18n.changeLanguage("zh");
    renderInbox();
    expect(screen.getByText("暂无通知")).toBeInTheDocument();
  });

  it("切换英文：页面标题为「Inbox」", async () => {
    await i18n.changeLanguage("en");
    renderInbox();
    expect(screen.getByText("Inbox")).toBeInTheDocument();
  });

  it("切换英文：副标题包含「batch processing」", async () => {
    await i18n.changeLanguage("en");
    renderInbox();
    expect(screen.getByText(/batch processing/i)).toBeInTheDocument();
  });

  it("切换英文：过滤按钮为「Unread only」", async () => {
    await i18n.changeLanguage("en");
    renderInbox();
    expect(screen.getByText("Unread only")).toBeInTheDocument();
  });

  it("切换英文：全选 label 为「Select all」", async () => {
    await i18n.changeLanguage("en");
    renderInbox();
    expect(screen.getByText("Select all")).toBeInTheDocument();
  });

  it("切换英文：标记已读按钮为「Mark read」", async () => {
    await i18n.changeLanguage("en");
    renderInbox();
    expect(screen.getByText("Mark read")).toBeInTheDocument();
  });

  it("切换英文：删除按钮为「Delete」（来自 common）", async () => {
    await i18n.changeLanguage("en");
    renderInbox();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("切换英文：空状态文案为「No notifications」", async () => {
    await i18n.changeLanguage("en");
    renderInbox();
    expect(screen.getByText("No notifications")).toBeInTheDocument();
  });

  // 纯键值断言（不依赖组件渲染）
  it("英文键值非空（inbox.page.title 有翻译）", () => {
    const val = i18n.t("page.title", { ns: "inbox", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("page.title");
  });

  it("英文键值非空（inbox.filter.unreadOnly 有翻译）", () => {
    const val = i18n.t("filter.unreadOnly", { ns: "inbox", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("filter.unreadOnly");
  });

  it("英文键值非空（inbox.filter.allSources 有翻译）", () => {
    const val = i18n.t("filter.allSources", { ns: "inbox", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("filter.allSources");
  });

  it("英文键值非空（inbox.bulk.markRead 有翻译）", () => {
    const val = i18n.t("bulk.markRead", { ns: "inbox", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("bulk.markRead");
  });

  it("英文键值非空（inbox.empty.unread 有翻译）", () => {
    const val = i18n.t("empty.unread", { ns: "inbox", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("empty.unread");
  });

  it("中文插值正确（inbox.time.minutesAgo）", () => {
    const val = i18n.t("time.minutesAgo", { ns: "inbox", lng: "zh", count: 5 });
    expect(val).toBe("5 分钟前");
  });

  it("英文插值正确（inbox.time.minutesAgo）", () => {
    const val = i18n.t("time.minutesAgo", { ns: "inbox", lng: "en", count: 5 });
    expect(val).toBe("5 min ago");
  });

  it("中文插值正确（inbox.bulk.markReadError 含 msg）", () => {
    const val = i18n.t("bulk.markReadError", { ns: "inbox", lng: "zh", msg: "网络错误" });
    expect(val).toBe("批量已读失败：网络错误");
  });

  it("英文插值正确（inbox.bulk.markReadError 含 msg）", () => {
    const val = i18n.t("bulk.markReadError", { ns: "inbox", lng: "en", msg: "network error" });
    expect(val).toContain("network error");
    expect(val).toBeTruthy();
  });

  it("中文插值正确（inbox.item.markReadError 含 msg）", () => {
    const val = i18n.t("item.markReadError", { ns: "inbox", lng: "zh", msg: "超时" });
    expect(val).toBe("标记已读失败：超时");
  });

  // 遍历所有顶层 section 的通用对称断言
  it("zh/en key 结构完全对称（inbox 命名空间所有顶层 section）", () => {
    type InboxBundle = Record<string, Record<string, string>>;
    const zh = i18n.getResourceBundle("zh", "inbox") as InboxBundle;
    const en = i18n.getResourceBundle("en", "inbox") as InboxBundle;

    // 顶层 section 集合相同
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());

    // 每个 section 内的键集合相同
    for (const section of Object.keys(zh)) {
      const zhSectionKeys = Object.keys(zh[section] ?? {}).sort();
      const enSectionKeys = Object.keys(en[section] ?? {}).sort();
      expect(enSectionKeys, `inbox:${section} zh/en key 不对称`).toEqual(zhSectionKeys);
    }
  });
});
