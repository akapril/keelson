// @vitest-environment jsdom
// 注意：.test.tsx 文件必须在文件头写 // @vitest-environment jsdom，
// 否则会静默用 node 环境失败（vitest.config.ts 默认 environment 为 "node"）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
import i18n from "../index";
import { LanguageSection } from "@/features/settings/LanguageSection";
import { currentChoice } from "@/features/settings/LanguageSection";

describe("LanguageSection", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(async () => {
    cleanup();
    // 复原为中文，避免污染后续用例（即使断言抛出也会执行）
    await i18n.changeLanguage("zh");
  });

  it("默认中文渲染标题「语言」", async () => {
    await i18n.changeLanguage("zh");
    render(<LanguageSection />);
    expect(screen.getByText("语言")).toBeInTheDocument();
  });

  it("切换到英文渲染「Language」", async () => {
    await i18n.changeLanguage("en");
    render(<LanguageSection />);
    expect(screen.getByText("Language")).toBeInTheDocument();
  });
});

describe("currentChoice 归一化逻辑", () => {
  beforeEach(() => { localStorage.clear(); });

  it('存 "en-US" 归一化为 "en"', () => {
    localStorage.setItem("i18nextLng", "en-US");
    expect(currentChoice()).toBe("en");
  });

  it('存 "zh-CN" 归一化为 "zh"', () => {
    localStorage.setItem("i18nextLng", "zh-CN");
    expect(currentChoice()).toBe("zh");
  });

  it("无值时返回 system", () => {
    expect(currentChoice()).toBe("system");
  });

  it('存 "en"（无区域后缀）归一化为 "en"', () => {
    localStorage.setItem("i18nextLng", "en");
    expect(currentChoice()).toBe("en");
  });
});
