// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("isTauri", () => {
  let originalInternals: unknown;

  beforeEach(() => {
    // 保存原始值
    originalInternals = (window as any).__TAURI_INTERNALS__;
  });

  afterEach(() => {
    // 恢复原始值
    if (originalInternals === undefined) {
      delete (window as any).__TAURI_INTERNALS__;
    } else {
      (window as any).__TAURI_INTERNALS__ = originalInternals;
    }
    // 重置模块缓存，确保每次导入都重新执行
    vi.resetModules();
  });

  it("当 __TAURI_INTERNALS__ 存在时返回 true", async () => {
    (window as any).__TAURI_INTERNALS__ = { some: "object" };
    const { isTauri } = await import("./env");
    expect(isTauri()).toBe(true);
  });

  it("当 __TAURI_INTERNALS__ 不存在时返回 false", async () => {
    delete (window as any).__TAURI_INTERNALS__;
    const { isTauri } = await import("./env");
    expect(isTauri()).toBe(false);
  });

  it("当 __TAURI_INTERNALS__ 为 undefined 时返回 false", async () => {
    (window as any).__TAURI_INTERNALS__ = undefined;
    const { isTauri } = await import("./env");
    expect(isTauri()).toBe(false);
  });

  it("当 __TAURI_INTERNALS__ 为空对象时仍返回 true", async () => {
    (window as any).__TAURI_INTERNALS__ = {};
    const { isTauri } = await import("./env");
    expect(isTauri()).toBe(true);
  });
});
