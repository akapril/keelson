// @vitest-environment jsdom
/**
 * webterm-ws.test.ts — openTerminalWs 单元测试
 *
 * 使用 mock WebSocket 验证：
 *   - send() 发送 stdin 文本（非 JSON）
 *   - resize() 发送正确 JSON 帧
 *   - 收 Binary 帧 触发 onData
 *   - 收 {type:"exit"} 触发 onExit
 *   - 非正常 close 触发状态 "reconnecting"
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openTerminalWs } from "../webterm-ws";
import type { TermCallbacks } from "../webterm-ws";

// ---- Mock WebSocket --------------------------------------------------------

interface MockWsInstance {
  url: string;
  binaryType: BinaryType;
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  /** 模拟服务端触发 open */
  simulateOpen: () => void;
  /** 模拟服务端推送消息 */
  simulateMessage: (data: string | ArrayBuffer) => void;
  /** 模拟连接关闭 */
  simulateClose: (code: number, reason?: string) => void;
}

let mockWsInstances: MockWsInstance[] = [];

class MockWebSocket implements MockWsInstance {
  url: string;
  binaryType: BinaryType = "blob";
  readyState: number = WebSocket.CONNECTING; // 0
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  send = vi.fn();
  close = vi.fn().mockImplementation(() => {
    // 模拟主动 close 触发 onclose(1000)
    this.readyState = WebSocket.CLOSED;
  });

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url: string) {
    this.url = url;
    mockWsInstances.push(this);
  }

  simulateOpen(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  simulateMessage(data: string | ArrayBuffer): void {
    const ev = new MessageEvent("message", { data });
    this.onmessage?.(ev);
  }

  simulateClose(code: number, reason = ""): void {
    this.readyState = WebSocket.CLOSED;
    const ev = new CloseEvent("close", { code, reason, wasClean: code === 1000 });
    this.onclose?.(ev);
  }
}

// ---- 测试套件 ---------------------------------------------------------------

describe("openTerminalWs", () => {
  beforeEach(() => {
    mockWsInstances = [];
    // 注入 mock WebSocket 到全局（jsdom 环境）
    vi.stubGlobal("WebSocket", MockWebSocket);
    // 屏蔽 location（jsdom 默认 about:blank，协议非 http/https）
    vi.stubGlobal("location", {
      protocol: "http:",
      host: "localhost:8090",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  it("构建正确的同源 WS URL（http → ws）", () => {
    const cb = makeCb();
    openTerminalWs("sess-1", { provider: "claude", path: "/home/user/proj" }, cb);

    expect(mockWsInstances).toHaveLength(1);
    const url = mockWsInstances[0].url;
    expect(url).toMatch(/^ws:\/\/localhost:8090\/ws\/terminal\/sess-1\?/);
    expect(url).toContain("provider=claude");
    expect(url).toContain("path=%2Fhome%2Fuser%2Fproj");
  });

  it("构建正确的 WSS URL（https → wss）", () => {
    vi.stubGlobal("location", { protocol: "https:", host: "example.com" });
    const cb = makeCb();
    openTerminalWs("s", { provider: "p", path: "/" }, cb);
    expect(mockWsInstances[0].url).toMatch(/^wss:\/\//);
  });

  it("设置 binaryType = arraybuffer", () => {
    const cb = makeCb();
    openTerminalWs("s", { provider: "p", path: "/" }, cb);
    expect(mockWsInstances[0].binaryType).toBe("arraybuffer");
  });

  // -------------------------------------------------------------------------
  it("open 后 onStatus('connected')", () => {
    const cb = makeCb();
    openTerminalWs("s", { provider: "p", path: "/" }, cb);
    const ws = mockWsInstances[0];
    ws.simulateOpen();
    expect(cb.onStatus).toHaveBeenCalledWith("connected");
  });

  // -------------------------------------------------------------------------
  it("send() 发送 stdin 文本（非 JSON）", () => {
    const cb = makeCb();
    const handle = openTerminalWs("s", { provider: "p", path: "/" }, cb);
    const ws = mockWsInstances[0];
    ws.simulateOpen();

    handle.send("ls -la\r");

    expect(ws.send).toHaveBeenCalledWith("ls -la\r");
    // 确认发送的是普通字符串，不是 JSON
    const arg: unknown = ws.send.mock.calls[0][0];
    expect(() => JSON.parse(arg as string)).toThrow();
  });

  // -------------------------------------------------------------------------
  it("resize() 发送正确 JSON 帧 {type,cols,rows}", () => {
    const cb = makeCb();
    const handle = openTerminalWs("s", { provider: "p", path: "/" }, cb);
    const ws = mockWsInstances[0];
    ws.simulateOpen();

    handle.resize(120, 40);

    expect(ws.send).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(ws.send.mock.calls[0][0] as string) as {
      type: string;
      cols: number;
      rows: number;
    };
    expect(frame).toEqual({ type: "resize", cols: 120, rows: 40 });
  });

  // -------------------------------------------------------------------------
  it("收 Binary 帧 → 触发 onData(Uint8Array)", () => {
    const cb = makeCb();
    openTerminalWs("s", { provider: "p", path: "/" }, cb);
    const ws = mockWsInstances[0];
    ws.simulateOpen();

    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    ws.simulateMessage(bytes.buffer);

    expect(cb.onData).toHaveBeenCalledTimes(1);
    const received = cb.onData.mock.calls[0][0] as Uint8Array;
    expect(received).toBeInstanceOf(Uint8Array);
    expect(Array.from(received)).toEqual([72, 101, 108, 108, 111]);
  });

  // -------------------------------------------------------------------------
  it("收 Text {type:'exit'} → 触发 onExit", () => {
    const cb = makeCb();
    openTerminalWs("s", { provider: "p", path: "/" }, cb);
    const ws = mockWsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage(JSON.stringify({ type: "exit" }));

    expect(cb.onExit).toHaveBeenCalledTimes(1);
  });

  it("收 Text 非 JSON → 忽略（不崩溃）", () => {
    const cb = makeCb();
    openTerminalWs("s", { provider: "p", path: "/" }, cb);
    const ws = mockWsInstances[0];
    ws.simulateOpen();

    // 不应抛出
    expect(() => ws.simulateMessage("not-json")).not.toThrow();
    expect(cb.onExit).not.toHaveBeenCalled();
    expect(cb.onData).not.toHaveBeenCalled();
  });

  it("收 Text {type:'unknown'} → 忽略（不崩溃）", () => {
    const cb = makeCb();
    openTerminalWs("s", { provider: "p", path: "/" }, cb);
    const ws = mockWsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage(JSON.stringify({ type: "unknown" }));
    expect(cb.onExit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  it("非正常 close (code=1006) → onStatus('reconnecting') → 发起重连", () => {
    vi.useFakeTimers();
    const cb = makeCb();
    openTerminalWs("s", { provider: "p", path: "/" }, cb);
    const ws = mockWsInstances[0];
    ws.simulateOpen();

    // 模拟异常断开（如网络中断，code=1006）
    ws.simulateClose(1006);

    expect(cb.onStatus).toHaveBeenCalledWith("reconnecting");

    // 推进定时器触发重连
    vi.runAllTimers();

    // 重连后应创建新的 WS 实例
    expect(mockWsInstances).toHaveLength(2);
  });

  it("正常 close (code=1000) → onStatus('closed')，不重连", () => {
    vi.useFakeTimers();
    const cb = makeCb();
    openTerminalWs("s", { provider: "p", path: "/" }, cb);
    const ws = mockWsInstances[0];
    ws.simulateOpen();

    ws.simulateClose(1000);

    vi.runAllTimers();

    // 仍然只有一个 WS 实例（未重连）
    expect(mockWsInstances).toHaveLength(1);
    expect(cb.onStatus).toHaveBeenCalledWith("closed");
  });

  // -------------------------------------------------------------------------
  it("close() 主动关闭 → onStatus('closed') 恰好一次，不重连", () => {
    vi.useFakeTimers();
    const cb = makeCb();
    const handle = openTerminalWs("s", { provider: "p", path: "/" }, cb);
    const ws = mockWsInstances[0];
    ws.simulateOpen();

    // 主动关闭：先调 handle.close()，再模拟浏览器异步触发 onclose(1000)
    handle.close();
    ws.simulateClose(1000); // 模拟浏览器 ws.close() 后触发的 onclose 事件

    vi.runAllTimers();

    // 主动关闭后不触发重连
    expect(mockWsInstances).toHaveLength(1);

    // onStatus("closed") 恰好被调用一次（由 onclose 的 manualClose 分支触发）
    const closedCalls = (cb.onStatus.mock.calls as [string][]).filter(
      ([s]) => s === "closed"
    );
    expect(closedCalls).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  it("未连接时 send/resize 静默失败（不崩溃）", () => {
    const cb = makeCb();
    const handle = openTerminalWs("s", { provider: "p", path: "/" }, cb);
    // 不调用 simulateOpen，readyState = CONNECTING

    expect(() => handle.send("data")).not.toThrow();
    expect(() => handle.resize(80, 24)).not.toThrow();
    // WS 处于 CONNECTING 状态，不应调用 send
    expect(mockWsInstances[0].send).not.toHaveBeenCalled();
  });
});

// ---- 辅助函数 ---------------------------------------------------------------

/** 回调对象类型：满足 TermCallbacks 并暴露 vi.fn mock 方法 */
interface TestCallbacks {
  onData: ReturnType<typeof vi.fn> & TermCallbacks["onData"];
  onExit: ReturnType<typeof vi.fn> & TermCallbacks["onExit"];
  onStatus: ReturnType<typeof vi.fn> & TermCallbacks["onStatus"];
}

/** 创建带有 vi.fn() 的回调对象 */
function makeCb(): TestCallbacks {
  return {
    onData: vi.fn() as TestCallbacks["onData"],
    onExit: vi.fn() as TestCallbacks["onExit"],
    onStatus: vi.fn() as TestCallbacks["onStatus"],
  };
}
