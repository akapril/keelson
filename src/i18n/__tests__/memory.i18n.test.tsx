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

import i18n from "../index";
import { MemoryEditDialog } from "@/features/memory/MemoryEditDialog";

// 渲染处于打开状态的 MemoryEditDialog
function renderDialog(open = true) {
  render(
    <MemoryEditDialog
      open={open}
      defaultValue="测试记忆内容"
      onResult={vi.fn()}
    />,
  );
}

describe("MemoryEditDialog i18n – memory 命名空间", () => {
  afterEach(async () => {
    cleanup();
    // 复原为中文，避免污染后续用例
    await i18n.changeLanguage("zh");
  });

  it("默认中文：标题为「编辑记忆」", async () => {
    await i18n.changeLanguage("zh");
    renderDialog();
    expect(screen.getByText("编辑记忆")).toBeInTheDocument();
  });

  it("默认中文：描述包含「尽量简洁」", async () => {
    await i18n.changeLanguage("zh");
    renderDialog();
    expect(screen.getByText(/尽量简洁/)).toBeInTheDocument();
  });

  it("默认中文：编辑 tab 按钮为「编辑」", async () => {
    await i18n.changeLanguage("zh");
    renderDialog();
    expect(screen.getByText("编辑")).toBeInTheDocument();
  });

  it("默认中文：预览 tab 按钮为「预览」", async () => {
    await i18n.changeLanguage("zh");
    renderDialog();
    expect(screen.getByText("预览")).toBeInTheDocument();
  });

  it("默认中文：取消按钮为「取消」（来自 common）", async () => {
    await i18n.changeLanguage("zh");
    renderDialog();
    expect(screen.getByText("取消")).toBeInTheDocument();
  });

  it("默认中文：保存按钮为「保存」（来自 common）", async () => {
    await i18n.changeLanguage("zh");
    renderDialog();
    expect(screen.getByText("保存")).toBeInTheDocument();
  });

  it("切换英文：标题为「Edit Memory」", async () => {
    await i18n.changeLanguage("en");
    renderDialog();
    expect(screen.getByText("Edit Memory")).toBeInTheDocument();
  });

  it("切换英文：编辑 tab 按钮为「Edit」", async () => {
    await i18n.changeLanguage("en");
    renderDialog();
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("切换英文：预览 tab 按钮为「Preview」", async () => {
    await i18n.changeLanguage("en");
    renderDialog();
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  it("切换英文：取消按钮为「Cancel」（来自 common）", async () => {
    await i18n.changeLanguage("en");
    renderDialog();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("切换英文：保存按钮为「Save」（来自 common）", async () => {
    await i18n.changeLanguage("en");
    renderDialog();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  // 纯键值断言（不依赖组件渲染）
  it("英文键值非空（memory:editDialog.title 有翻译）", () => {
    const val = i18n.t("editDialog.title", { ns: "memory", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("editDialog.title");
  });

  it("英文键值非空（memory:editDialog.emptyPreview 有翻译）", () => {
    const val = i18n.t("editDialog.emptyPreview", { ns: "memory", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("editDialog.emptyPreview");
  });

  it("英文键值非空（memory:reviewDialog.toastSuccess 有翻译）", () => {
    const val = i18n.t("reviewDialog.toastSuccess", { ns: "memory", lng: "en", count: 3 });
    expect(val).toBeTruthy();
    expect(val).not.toBe("reviewDialog.toastSuccess");
  });

  it("英文键值非空（memory:filesBar.syncButton 有翻译）", () => {
    const val = i18n.t("filesBar.syncButton", { ns: "memory", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("filesBar.syncButton");
  });

  it("中文插值正确（memory:reviewDialog.footerCount）", () => {
    const val = i18n.t("reviewDialog.footerCount", { ns: "memory", lng: "zh", fresh: 3, selected: 2 });
    expect(val).toBe("3 条新 · 已选 2");
  });

  it("英文插值正确（memory:reviewDialog.footerCount）", () => {
    const val = i18n.t("reviewDialog.footerCount", { ns: "memory", lng: "en", fresh: 3, selected: 2 });
    expect(val).toBe("3 new · 2 selected");
  });

  it("中文 kind 标签：fact→「事实」", () => {
    const val = i18n.t("kind.fact", { ns: "memory", lng: "zh" });
    expect(val).toBe("事实");
  });

  it("英文 kind 标签：fact→「Fact」", () => {
    const val = i18n.t("kind.fact", { ns: "memory", lng: "en" });
    expect(val).toBe("Fact");
  });

  it("英文 kind 标签：preference→「Preference」", () => {
    const val = i18n.t("kind.preference", { ns: "memory", lng: "en" });
    expect(val).toBe("Preference");
  });

  it("英文 kind 标签：decision→「Decision」", () => {
    const val = i18n.t("kind.decision", { ns: "memory", lng: "en" });
    expect(val).toBe("Decision");
  });

  it("英文 kind 标签：convention→「Convention」", () => {
    const val = i18n.t("kind.convention", { ns: "memory", lng: "en" });
    expect(val).toBe("Convention");
  });
});
