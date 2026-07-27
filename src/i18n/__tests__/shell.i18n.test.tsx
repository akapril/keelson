// @vitest-environment jsdom
// 注意：.test.tsx 文件必须在文件头写 // @vitest-environment jsdom，
// 否则会静默用 node 环境失败（vitest.config.ts 默认 environment 为 "node"）。
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock Tauri APIs（TitleBar 依赖 getCurrentWindow）
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  })),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

import i18n from "../index";
import { TitleBar } from "@/components/title-bar";

describe("TitleBar i18n – shell 命名空间", () => {
  afterEach(async () => {
    cleanup();
    // 复原为中文，避免污染后续用例（即使断言抛出也会执行）
    await i18n.changeLanguage("zh");
  });

  it("默认中文渲染「最小化」aria-label", async () => {
    await i18n.changeLanguage("zh");
    render(<TitleBar />);
    expect(screen.getByRole("button", { name: "最小化" })).toBeInTheDocument();
  });

  it("默认中文渲染「最大化 / 还原」aria-label", async () => {
    await i18n.changeLanguage("zh");
    render(<TitleBar />);
    expect(screen.getByRole("button", { name: "最大化 / 还原" })).toBeInTheDocument();
  });

  it("默认中文渲染「关闭」aria-label", async () => {
    await i18n.changeLanguage("zh");
    render(<TitleBar />);
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });

  it("切换到英文后渲染「Minimize」aria-label", async () => {
    await i18n.changeLanguage("en");
    render(<TitleBar />);
    expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument();
  });

  it("切换到英文后渲染「Maximize / Restore」aria-label", async () => {
    await i18n.changeLanguage("en");
    render(<TitleBar />);
    expect(screen.getByRole("button", { name: "Maximize / Restore" })).toBeInTheDocument();
  });

  it("切换到英文后渲染「Close」aria-label", async () => {
    await i18n.changeLanguage("en");
    render(<TitleBar />);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("英文键值非空（shell.titleBar.minimize 有翻译）", () => {
    const val = i18n.t("titleBar.minimize", { ns: "shell", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("titleBar.minimize");
  });
});
