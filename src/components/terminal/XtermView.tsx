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
      // 末尾补 CJK 等宽兜底：中文字形宽度更一致，缓解 IME 组字时的左移/抖动
      fontFamily:
        '"JetBrains Mono", "Cascadia Code", Menlo, Consolas, "Sarasa Mono SC", "Microsoft YaHei", "PingFang SC", "Noto Sans Mono CJK SC", monospace',
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

    // 主题竞态修复：硬刷新后 xterm 可能在主题 class 应用到 <html> 之前挂载 →
    // resolveXtermTheme 读到默认(浅色)调色板致"刷新后颜色变了"。观察 <html> class 变化，
    // 主题一变即重解析并重应用（同时覆盖运行时明暗切换）。
    const themeObserver = new MutationObserver(() => {
      term.options.theme = resolveXtermTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // 移动端触摸滑动滚动历史：xterm 的 canvas 层遮挡可滚动 viewport，原生触摸滚不动，
    // 故自行手势 → term.scrollLines（手指下滑=看历史/上滚）。仅真正滚动时 preventDefault，
    // 避免误吞点击聚焦；单指才处理（双指缩放/其它手势放行）。
    const cellH = 14 * 1.4; // 真实行高 fontSize*lineHeight，供 alt-screen 滚轮算行号
    // 每滑动多少像素触发一档滚动：越小越跟手（灵敏），越大越钝。取行高 0.6 倍更跟手。
    const STEP_PX = cellH * 0.6;
    let touchY: number | null = null;
    let accum = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchY = e.touches[0].clientY;
        accum = 0;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (touchY === null || e.touches.length !== 1) return;
      // 单指拖拽期间一律 preventDefault：否则起手的前几像素(lines 仍为 0)会被浏览器
      // 当成下拉刷新/页面滚动抢走，导致"下滑刷新页面、终端没滚"。
      e.preventDefault();
      const y = e.touches[0].clientY;
      accum += y - touchY;
      touchY = y;
      const lines = Math.trunc(accum / STEP_PX);
      if (lines === 0) return;
      accum -= lines * STEP_PX;
      // 备用屏(alt-screen，如 claude/codex 全屏交互界面)无 xterm 回滚缓冲，scrollLines 无效。
      // 方向键会被当成输入历史导航（碰输入框），故改**模拟鼠标滚轮**(SGR 1006)：这类 TUI 开了
      // 鼠标追踪，滚轮走鼠标通道、不碰输入——桌面终端就是这样滚 claude 的。
      // 下滑 lines>0 = 看更早内容 = 滚轮上(按钮 64)；lines<0 = 滚轮下(65)。
      if (term.buffer.active.type === "alternate") {
        const rect = el.getBoundingClientRect();
        const row = Math.min(term.rows, Math.max(1, Math.ceil((y - rect.top) / cellH)));
        const col = Math.max(1, Math.round(term.cols / 2));
        const btn = lines > 0 ? 64 : 65;
        const seq = `\x1b[<${btn};${col};${row}M`;
        const n = Math.min(Math.abs(lines), 20); // 限幅，避免一次甩太多
        for (let i = 0; i < n; i++) wsRef.current?.send(seq);
      } else {
        // 普通屏：xterm 本地回滚缓冲滚动。
        term.scrollLines(-lines);
      }
    };
    const onTouchEnd = () => {
      touchY = null;
    };
    const el = containerRef.current;
    // touchmove 用捕获阶段 + 非被动：先于 xterm 内部处理拿到事件、可 preventDefault。
    el.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });

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
      themeObserver.disconnect();
      el.removeEventListener("touchstart", onTouchStart, { capture: true });
      el.removeEventListener("touchmove", onTouchMove, { capture: true });
      el.removeEventListener("touchend", onTouchEnd, { capture: true });
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
      // xterm 内部 canvas 需要明确尺寸，flex 布局下继承父高。
      // touchAction:none → 浏览器不对终端上的触摸做默认滚动/缩放/下拉刷新，全交给手势处理；
      // overscrollBehavior:contain → 兜底阻断下拉刷新透传到页面。
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        touchAction: "none",
        overscrollBehavior: "contain",
      }}
      aria-label="Terminal"
      role="region"
    />
  );
});
