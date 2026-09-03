// @vitest-environment jsdom
/**
 * InteractivePtyView.test.tsx — 接线契约验证
 *
 * 用 mock 替换：
 *   @xterm/xterm：不真渲染 canvas，仅捕获 onData 回调 + write 调用
 *   @xterm/addon-fit：stub FitAddon
 *   @tauri-apps/api/event：捕获订阅的事件名
 *   @tauri-apps/api/core：记录 invoke 调用
 *   react-i18next：返回 key 桩，避免 provider 依赖
 */
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// mock xterm：不真渲染 canvas，仅捕获 onData 回调与 write 调用
const writeSpy = vi.fn();
let onDataCb: ((d: string) => void) | null = null;

// 用 class 语法让 new Terminal() 能正常工作
vi.mock("@xterm/xterm", () => {
  class MockTerminal {
    cols = 80;
    rows = 24;
    loadAddon = vi.fn();
    open = vi.fn();
    write = writeSpy;
    writeln = vi.fn();
    dispose = vi.fn();
    onData(cb: (d: string) => void) {
      onDataCb = cb;
      return { dispose: vi.fn() };
    }
  }
  return { Terminal: MockTerminal };
});

vi.mock("@xterm/addon-fit", () => {
  class MockFitAddon {
    fit = vi.fn();
  }
  return { FitAddon: MockFitAddon };
});

// 捕获 listen 的事件名；invoke 记录调用
const listened: string[] = [];
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string) => {
    listened.push(name);
    return Promise.resolve(() => {});
  },
}));
const invokeSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invokeSpy(...a),
}));

// jsdom 未内置 ResizeObserver，polyfill 一个 stub
if (typeof ResizeObserver === "undefined") {
  global.ResizeObserver = class ResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
}

// mock react-i18next：返回 key 桩，避免 I18nextProvider 依赖
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh" },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));

// xterm-shared 里调 getComputedStyle（jsdom 环境下为空），mock 掉以免报错
vi.mock("../xterm-shared", () => ({
  resolveXtermTheme: () => ({
    background: "#1a1b1e",
    foreground: "#c9d1d9",
    cursor: "#58a6ff",
    selectionBackground: "#3d444d40",
  }),
  makeSafeFit: (getContainer: () => HTMLElement | null, fit: () => void) => {
    // 在 jsdom 中 clientWidth/Height 始终为 0，直接返回总是 skip 的 stub
    // 但需要能调用 fit，测试只关注接线逻辑，不关注 fit 触发
    return () => {
      const el = getContainer();
      if (!el) return false;
      try { fit(); } catch { /* ignore */ }
      return true;
    };
  },
  // WebGL 渲染器在 jsdom 无 GL 上下文，桩成 noop（返回 noop 清理函数），不影响接线测试
  loadWebglRenderer: () => () => {},
}));

import { InteractivePtyView } from "../InteractivePtyView";

describe("InteractivePtyView", () => {
  beforeEach(() => {
    listened.length = 0;
    onDataCb = null;
    invokeSpy.mockClear();
    writeSpy.mockClear();
  });

  it("订阅 output/exit 事件并把键入转发到 runtime_pty_input", async () => {
    render(<InteractivePtyView id="abc123" />);
    // 等 effect 内异步 listen 注册完成
    await Promise.resolve();
    await Promise.resolve(); // 双 tick 确保两个 listen Promise 都已 push

    expect(listened).toContain("runtime-pty-output:abc123");
    expect(listened).toContain("runtime-pty-exit:abc123");

    // 模拟键入 → 调 runtime_pty_input
    onDataCb?.("p");
    expect(invokeSpy).toHaveBeenCalledWith("runtime_pty_input", {
      id: "abc123",
      data: "p",
    });
  });
});
