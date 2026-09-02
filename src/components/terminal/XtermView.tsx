/**
 * XtermView.tsx — 终端视图组件
 *
 * 封装 xterm.js + FitAddon，接线 webterm-ws 双向通信：
 *   pty 输出 → term.write(bytes)
 *   term.onData → ws.send(str)（stdin）
 *   ResizeObserver → fit() + ws.resize(cols, rows)
 *
 * 主题：从 CSS 变量读取 --background / --foreground 等语义色，
 * 避免硬编码 hex，确保深/浅色模式均适配。
 *
 * ref 暴露：XtermHandle.sendInput(data) 供父组件（虚拟按键条）发送控制字节。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { openTerminalWs, type WsStatus } from "@/web/webterm-ws";
import { resolveXtermTheme, makeSafeFit } from "./xterm-shared";

/** 通过 ref 暴露给父组件的句柄 */
export interface XtermHandle {
  /** 向 pty stdin 发送原始字节序列（用于虚拟按键条的控制字符） */
  sendInput: (data: string) => void;
  /** 滚动终端 viewport 若干行（负=向上看历史，正=向下）——移动端触摸滚不动时用按钮驱动 */
  scrollLines: (amount: number) => void;
  /** 滚回底部（最新输出） */
  scrollToBottom: () => void;
}

export interface XtermViewProps {
  /** 终端会话 ID（路由到 /ws/terminal/:sessionId） */
  sessionId: string;
  /** 会话所属 provider（如 "claude"） */
  provider: string;
  /** 项目路径（查询参数 path=...） */
  projectPath: string;
  /** pty 退出回调（可选） */
  onExit?: () => void;
  /** 连接状态变化回调（可选，供父组件显示状态角标） */
  onStatusChange?: (s: WsStatus) => void;
  /** 额外 className，供布局层控制尺寸 */
  className?: string;
}

/**
 * XtermView — 挂载 xterm Terminal + FitAddon，接线 webterm-ws。
 *
 * 生命周期：
 *   mount → new Terminal() → new FitAddon() → attach → open → fit → connect WS
 *   ResizeObserver → fit() + ws.resize(term.cols, term.rows)
 *   unmount → term.dispose() + ws.close()
 *
 * forwardRef 暴露 XtermHandle.sendInput()，供虚拟按键条发控制字节。
 */
export const XtermView = forwardRef<XtermHandle, XtermViewProps>(function XtermView(
  {
    sessionId,
    provider,
    projectPath,
    onExit,
    onStatusChange,
    className,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  // ws 句柄用 ref 存储，供 useImperativeHandle 中的 sendInput 访问
  const wsRef = useRef<{ send: (data: string) => void } | null>(null);
  // term 实例 ref，供命令式滚动（移动端滚动按钮）
  const termRef = useRef<Terminal | null>(null);

  // 用 ref 存最新回调，避免回调引用变化导致 effect 重跑（Terminal 重挂/闪烁）
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // 暴露 sendInput + 滚动给父组件（虚拟按键条使用）
  useImperativeHandle(ref, () => ({
    sendInput(data: string) {
      wsRef.current?.send(data);
    },
    scrollLines(amount: number) {
      termRef.current?.scrollLines(amount);
    },
    scrollToBottom() {
      termRef.current?.scrollToBottom();
    },
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;

    // 解析主题色（首次挂载时读取 CSS 变量，适配当前深/浅模式）
    const theme = resolveXtermTheme();

    // 初始化 Terminal
    const term = new Terminal({
      theme,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.4,
      cursorBlink: true,
      allowProposedApi: false,
      scrollback: 5000,
    });

    // 挂载 FitAddon（自动根据容器尺寸设置 cols/rows）
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // 仅在容器可见（有实际尺寸）时 fit：keep-alive 布局下切走 tab 会把容器设为
    // display:none（clientWidth/Height=0），此时 fit() 会算出 1x1 破坏终端；跳过即可，
    // 切回可见时 ResizeObserver 会再触发一次正常 fit。返回是否真正执行了 fit。
    const safeFit = makeSafeFit(
      () => containerRef.current,
      () => fitAddon.fit(),
    );

    // 渲染到 DOM
    term.open(containerRef.current);
    termRef.current = term;
    safeFit();

    // 连接 WS（回调经 ref 取最新值，不将函数引用纳入 effect deps）
    const ws = openTerminalWs(
      sessionId,
      { provider, path: projectPath },
      {
        onData(bytes) {
          term.write(bytes);
        },
        onExit() {
          term.writeln("\r\n\x1b[2m[process exited]\x1b[0m");
          onExitRef.current?.();
        },
        onStatus(s) {
          onStatusChangeRef.current?.(s);
          // WS 建立后立即把 xterm 实际尺寸同步给 PTY：否则 PTY 停留后端默认 80x24，
          // agent 按 80 列换行而前端 xterm 实际宽度不同 → 换行错位/显示混乱。
          // （挂载时 ResizeObserver 首帧的 resize 可能在 WS 尚未 open 时发出而丢失，
          //  故必须在 connected 时补发一次权威尺寸。）
          if (s === "connected") {
            safeFit();
            ws.resize(term.cols, term.rows);
          }
        },
      }
    );

    // 将 ws 句柄存入 ref，供 sendInput 访问
    wsRef.current = ws;

    // 键盘输入 → stdin（term.onData 发出 xterm 解码后的字符序列）
    const dataDisposable = term.onData((str) => {
      ws.send(str);
    });

    // 容器尺寸变化 → fit + resize 帧。隐藏(0 尺寸)时 safeFit 跳过，不下发无意义 resize。
    const observer = new ResizeObserver(() => {
      // fit() 内部会重新计算 cols/rows；仅在真正 fit 后才把新尺寸同步给 PTY
      if (safeFit()) {
        ws.resize(term.cols, term.rows);
      }
    });
    observer.observe(containerRef.current);

    // 清理：卸载时释放所有资源
    return () => {
      wsRef.current = null;
      termRef.current = null;
      observer.disconnect();
      dataDisposable.dispose();
      ws.close();
      term.dispose();
    };
  // deps 仅保留会导致会话变化的值；onExit/onStatusChange 经 ref 传递，不纳入
  }, [sessionId, provider, projectPath]);

  return (
    <div
      ref={containerRef}
      className={className}
      // xterm 内部 canvas 需要明确尺寸，flex 布局下继承父高
      style={{ width: "100%", height: "100%", overflow: "hidden" }}
      aria-label="Terminal"
      role="region"
    />
  );
});
