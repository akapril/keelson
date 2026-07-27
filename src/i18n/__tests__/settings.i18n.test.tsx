// @vitest-environment jsdom
// 注意：.test.tsx 文件必须在文件头写 // @vitest-environment jsdom，
// 否则会静默用 node 环境失败（vitest.config.ts 默认 environment 为 "node"）。
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock Tauri APIs（store/settings 会触发 Tauri invoke）
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock settings store
vi.mock("@/store/settings", () => ({
  useSettingsStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      hotkey: "CommandOrControl+Space",
      loading: false,
      saveHotkey: vi.fn(),
      workspacePath: "/home/user/projects",
      aiConfig: {
        provider: "openai",
        base_url: "",
        api_key: "",
        model: "",
        cli_path: null,
      },
      setAiConfig: vi.fn(),
    }),
  ),
}));

// Mock project-tab-pref（ProjectDefaultTabSection 依赖）
vi.mock("@/features/board/project-tab-pref", () => ({
  WORKSPACE_TABS: [
    { value: "overview", label: "概览" },
    { value: "sessions", label: "会话" },
    { value: "board", label: "看板" },
    { value: "docs", label: "文档" },
    { value: "activity", label: "活动" },
    { value: "ai", label: "AI" },
  ],
  getDefaultTab: vi.fn(() => "board"),
  setDefaultTab: vi.fn(),
}));

import i18n from "../index";
import { ProjectDefaultTabSection } from "@/features/settings/ProjectDefaultTabSection";

function renderSection() {
  render(<ProjectDefaultTabSection />);
}

describe("ProjectDefaultTabSection i18n – settings 命名空间", () => {
  afterEach(async () => {
    cleanup();
    // 复原为中文，避免污染后续用例
    await i18n.changeLanguage("zh");
  });

  it("默认中文：标题显示「项目默认打开标签页」", async () => {
    await i18n.changeLanguage("zh");
    renderSection();
    expect(screen.getByText("项目默认打开标签页")).toBeInTheDocument();
  });

  it("切换英文：标题显示「Project Default Tab」", async () => {
    await i18n.changeLanguage("en");
    renderSection();
    expect(screen.getByText("Project Default Tab")).toBeInTheDocument();
  });

  it("中文键值非空（settings.projectDefaultTab.title 有翻译）", () => {
    const val = i18n.t("projectDefaultTab.title", { ns: "settings", lng: "zh" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("projectDefaultTab.title");
    expect(val).toBe("项目默认打开标签页");
  });

  it("英文键值非空（settings.projectDefaultTab.title 有翻译）", () => {
    const val = i18n.t("projectDefaultTab.title", { ns: "settings", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("projectDefaultTab.title");
    expect(val).toBe("Project Default Tab");
  });

  it("中文 settings.page.title 为「设置」", () => {
    const val = i18n.t("page.title", { ns: "settings", lng: "zh" });
    expect(val).toBe("设置");
  });

  it("英文 settings.page.title 为「Settings」", () => {
    const val = i18n.t("page.title", { ns: "settings", lng: "en" });
    expect(val).toBe("Settings");
  });

  it("中文 tab 标签翻译：board 为「看板」", () => {
    const val = i18n.t("projectDefaultTab.tabs.board", { ns: "settings", lng: "zh" });
    expect(val).toBe("看板");
  });

  it("英文 tab 标签翻译：board 为「Board」", () => {
    const val = i18n.t("projectDefaultTab.tabs.board", { ns: "settings", lng: "en" });
    expect(val).toBe("Board");
  });

  it("中文 tabs 全部有翻译（非空、非 key）", () => {
    const tabs = ["overview", "sessions", "board", "docs", "activity", "ai"];
    for (const tab of tabs) {
      const val = i18n.t(`projectDefaultTab.tabs.${tab}`, { ns: "settings", lng: "zh" });
      expect(val, `zh tab ${tab} 不应为 key 本身`).not.toBe(`projectDefaultTab.tabs.${tab}`);
      expect(val).toBeTruthy();
    }
  });

  it("英文 tabs 全部有翻译（非空、非 key）", () => {
    const tabs = ["overview", "sessions", "board", "docs", "activity", "ai"];
    for (const tab of tabs) {
      const val = i18n.t(`projectDefaultTab.tabs.${tab}`, { ns: "settings", lng: "en" });
      expect(val, `en tab ${tab} 不应为 key 本身`).not.toBe(`projectDefaultTab.tabs.${tab}`);
      expect(val).toBeTruthy();
    }
  });

  it("中文 autoArchive.options 全部有翻译", () => {
    const keys = ["off", "days3", "days7", "days14", "days30"];
    for (const key of keys) {
      const val = i18n.t(`autoArchive.options.${key}`, { ns: "settings", lng: "zh" });
      expect(val).toBeTruthy();
      expect(val).not.toBe(`autoArchive.options.${key}`);
    }
  });

  it("英文 autoArchive.options 全部有翻译", () => {
    const keys = ["off", "days3", "days7", "days14", "days30"];
    for (const key of keys) {
      const val = i18n.t(`autoArchive.options.${key}`, { ns: "settings", lng: "en" });
      expect(val).toBeTruthy();
      expect(val).not.toBe(`autoArchive.options.${key}`);
    }
  });

  it("中文 ai.model.fetchSuccess 插值正确", () => {
    const val = i18n.t("ai.model.fetchSuccess", { ns: "settings", lng: "zh", count: 5 });
    expect(val).toBe("获取到 5 个模型");
  });

  it("英文 ai.model.fetchSuccess 插值正确", () => {
    const val = i18n.t("ai.model.fetchSuccess", { ns: "settings", lng: "en", count: 5 });
    expect(val).toBe("Found 5 models");
  });

  it("中文 embed.indexStale 插值正确", () => {
    const val = i18n.t("embed.indexStale", { ns: "settings", lng: "zh", model: "api:text-embedding-3-small" });
    expect(val).toContain("api:text-embedding-3-small");
  });

  it("英文 embed.indexStale 插值正确", () => {
    const val = i18n.t("embed.indexStale", { ns: "settings", lng: "en", model: "api:text-embedding-3-small" });
    expect(val).toContain("api:text-embedding-3-small");
  });

  it("language 段仍存在且未变（Task 2 已有）", () => {
    const zh = i18n.t("language.title", { ns: "settings", lng: "zh" });
    const en = i18n.t("language.title", { ns: "settings", lng: "en" });
    expect(zh).toBe("语言");
    expect(en).toBe("Language");
  });

  it("中文 notify.types 通知类型标签全部有翻译", () => {
    const sources = ["沉淀", "截止提醒", "会话", "更新", "MCP", "Loop"];
    for (const src of sources) {
      const val = i18n.t(`notify.types.${src}`, { ns: "settings", lng: "zh" });
      expect(val).toBeTruthy();
      expect(val).not.toBe(`notify.types.${src}`);
    }
  });

  it("英文 notify.types 通知类型标签全部有翻译", () => {
    const sources = ["沉淀", "截止提醒", "会话", "更新", "MCP", "Loop"];
    for (const src of sources) {
      const val = i18n.t(`notify.types.${src}`, { ns: "settings", lng: "en" });
      expect(val).toBeTruthy();
      expect(val).not.toBe(`notify.types.${src}`);
    }
  });

  it("中文 shortcut.ariaLabel 插值正确", () => {
    const val = i18n.t("shortcut.ariaLabel", { ns: "settings", lng: "zh", value: "Ctrl+Space" });
    expect(val).toContain("Ctrl+Space");
  });
});
