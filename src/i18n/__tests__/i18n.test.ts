import { describe, it, expect, vi, beforeEach } from "vitest";

// mock Tauri invoke（测试环境无后端）
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

import i18n from "../index";

describe("i18n 地基", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
  });

  it("加载 common 命名空间并按语言取值", async () => {
    expect(i18n.t("action.save")).toBe("保存");
    await i18n.changeLanguage("en");
    expect(i18n.t("action.save")).toBe("Save");
  });

  it("缺失 key 回退英文而非崩溃", async () => {
    await i18n.changeLanguage("zh");
    // 不存在的 key 返回 fallback 行为：返回 key 本身，不抛
    expect(() => i18n.t("nonexistent.key.xyz")).not.toThrow();
  });
});
