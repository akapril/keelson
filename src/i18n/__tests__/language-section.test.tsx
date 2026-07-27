// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
import i18n from "../index";
import { LanguageSection } from "@/features/settings/LanguageSection";

describe("LanguageSection", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { cleanup(); });

  it("默认中文渲染标题「语言」", async () => {
    await i18n.changeLanguage("zh");
    render(<LanguageSection />);
    expect(screen.getByText("语言")).toBeInTheDocument();
  });

  it("切换到英文渲染「Language」", async () => {
    await i18n.changeLanguage("en");
    render(<LanguageSection />);
    expect(screen.getByText("Language")).toBeInTheDocument();
    await i18n.changeLanguage("zh");
  });
});
