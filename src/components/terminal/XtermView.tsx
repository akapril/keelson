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
import type { Terminal } from "@xterm/xterm";
import type { SearchAddon } from "@xterm/addon-search";
import { openTerminalWs, type WsStatus, type TermWsHandle } from "@/web/webterm-ws";
import { createXtermCore, SEARCH_DECORATIONS } from "./xterm-shared";

/** 通过 ref 暴露给父组件的句柄 */
export interface XtermHandle {
  /** 向 pty stdin 发送原始字节序列（用于虚拟按键条的控制字符） */
  sendInput: (data: string) => void;
  /** 滚动终端 viewport 若干行（负=向上看历史，正=向下）——移动端触摸滚不动时用按钮驱动 */
  scrollLines: (amount: number) => void;
  /** 滚回底部（最新输出） */
  scrollToBottom: () => void;
  /** 显式弹出移动端软键盘（默认聚焦不弹，避免点终端就挡界面）：临时开 inputmode 再聚焦 */
  focusKeyboard: () => void;
  /** 倒出终端缓冲区文本（普通屏=含回滚的完整历史；备用屏=当前可见屏）。供「查看/复制」文本浮层。 */
  getText: () => string;
  /** 搜索回滚缓冲：查找下一个匹配（空串则清除高亮）。供搜索框接线。 */
  findNext: (query: string) => void;
  /** 搜索回滚缓冲：查找上一个匹配（空串则清除高亮）。 */
  findPrevious: (query: string) => void;
  /** 清除搜索高亮与选区。 */
  clearSearch: () => void;
  /** 调整字号（delta 正=放大/负=缩小，带上下限）并重新 fit。移动端小屏调节可读性。 */
  adjustFontSize: (delta: number) => void;
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
  /** 移动端长按终端回调：canvas 无法原生选中文字，故长按转为打开可选文本层（复制历史） */
  onLongPress?: () => void;
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
    onLongPress,
    className,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  // ws 句柄用 ref 存储，供 useImperativeHandle 中的 sendInput / resize 访问
  const wsRef = useRef<TermWsHandle | null>(null);
  // term 实例 ref，供命令式滚动（移动端滚动按钮）
  const termRef = useRef<Terminal | null>(null);
  // 搜索插件 ref（供搜索框查找）、safeFit ref（供调字号后重新 fit）
  const searchRef = useRef<SearchAddon | null>(null);
  const safeFitRef = useRef<(() => boolean) | null>(null);

  // 用 ref 存最新回调，避免回调引用变化导致 effect 重跑（Terminal 重挂/闪烁）
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;

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
    focusKeyboard() {
      // 用户显式点「键盘」才弹：把隐藏输入框 inputmode 改回 text 并**直接聚焦**它。
      // 直接 ta.focus()（而非 term.focus）+ 在点击手势内同步执行，iOS 才可靠拉起软键盘。
      const ta = containerRef.current?.querySelector<HTMLTextAreaElement>(
        ".xterm-helper-textarea",
      );
      if (!ta) {
        termRef.current?.focus();
        return;
      }
      ta.inputMode = "text";
      ta.focus();
    },
    getText() {
      const term = termRef.current;
      if (!term) return "";
      const buf = term.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i);
        lines.push(line ? line.translateToString(true) : "");
      }
      // 去掉尾部连续空行，避免一大片空白
      while (lines.length && lines[lines.length - 1] === "") lines.pop();
      return lines.join("\n");
    },
    findNext(query: string) {
      const s = searchRef.current;
      if (!s) return;
      if (!query) {
        s.clearDecorations();
        return;
      }
      s.findNext(query, { decorations: SEARCH_DECORATIONS });
    },
    findPrevious(query: string) {
      const s = searchRef.current;
      if (!s) return;
      if (!query) {
        s.clearDecorations();
        return;
      }
      s.findPrevious(query, { decorations: SEARCH_DECORATIONS });
    },
    clearSearch() {
      searchRef.current?.clearDecorations();
    },
    adjustFontSize(delta: number) {
      const term = termRef.current;
      if (!term) return;
      const cur = term.options.fontSize ?? 14;
      const next = Math.min(24, Math.max(8, cur + delta)); // 上下限 8~24px
      if (next === cur) return;
      term.options.fontSize = next;
      // 字号变了要重新 fit（cols/rows 变化），并把新尺寸同步给 PTY，避免换行错位。
      if (safeFitRef.current?.()) wsRef.current?.resize(term.cols, term.rows);
    },
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;

    // 创建终端核心（new Terminal + FitAddon + 挂载 + WebGL + 搜索 + 可点链接 + 主题实时跟随 +
    // safeFit，见 createXtermCore；与桌面终端复用同一套样板）。传输/触摸/键盘等仍在本视图接线。
    // web 端提供 onLinkClick=window.open：输出里的 URL 可点开（新标签页）。
    const core = createXtermCore(containerRef.current, {
      onLinkClick: (uri) => window.open(uri, "_blank", "noopener,noreferrer"),
    });
    const { term, safeFit } = core;
    termRef.current = term;
    searchRef.current = core.search;
    safeFitRef.current = safeFit;

    // 移动端软键盘策略：**点终端即聚焦隐藏输入框、直接弹出软键盘**（与桌面/普通输入框一致，最直觉）。
    // 键盘遮挡问题改由外层 visualViewport 方案解决（根容器随可视高度收缩+顶起，输入行落到键盘之上），
    // 不再用 inputmode="none" 抑制键盘。滚动历史仍走触摸手势（onTouchMove，见下）。

    // 移动端触摸滑动滚动历史：xterm 的 canvas 层遮挡可滚动 viewport，原生触摸滚不动，
    // 故自行手势 → term.scrollLines（手指下滑=看历史/上滚）。仅真正滚动时 preventDefault，
    // 避免误吞点击聚焦；单指才处理（双指缩放/其它手势放行）。
    // 真实行高 = 当前 fontSize * lineHeight（动态读取：调字号后滚动步长/行号仍准确）。
    const cellHeight = () => (term.options.fontSize ?? 14) * 1.4;
    let touchY: number | null = null;
    let touchStartY = 0; // 起手 Y，判长按期间是否明显移动
    let accum = 0;
    // 长按检测：canvas 无原生可选文字，故长按(≥500ms 基本不动) → 打开可选文本层复制历史。
    const LONG_PRESS_MS = 500;
    const LONG_PRESS_MOVE_TOL = 10; // 移动超过此像素即视为滚动，取消长按
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelLongPress = () => {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchY = e.touches[0].clientY;
        touchStartY = e.touches[0].clientY;
        accum = 0;
        cancelLongPress();
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          touchY = null; // 停止把本次手势当滚动
          navigator.vibrate?.(10); // 触感反馈（支持则振一下）
          onLongPressRef.current?.();
        }, LONG_PRESS_MS);
      } else {
        cancelLongPress(); // 多指：取消长按
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (touchY === null || e.touches.length !== 1) return;
      // 明显移动即取消长按（这是滚动而非长按）。
      if (Math.abs(e.touches[0].clientY - touchStartY) > LONG_PRESS_MOVE_TOL) cancelLongPress();
      // 单指拖拽期间一律 preventDefault：否则起手的前几像素(lines 仍为 0)会被浏览器
      // 当成下拉刷新/页面滚动抢走，导致"下滑刷新页面、终端没滚"。
      e.preventDefault();
      const y = e.touches[0].clientY;
      accum += y - touchY;
      touchY = y;
      // 每滑一整行行高滚一行(1:1)，最自然可控。
      const cellH = cellHeight();
      const lines = Math.trunc(accum / cellH);
      if (lines === 0) return;
      accum -= lines * cellH;
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
      cancelLongPress();
    };
    const el = containerRef.current;
    // touchmove 用捕获阶段 + 非被动：先于 xterm 内部处理拿到事件、可 preventDefault。
    el.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });

    // ── PC 鼠标：选中即复制 + 右键粘贴（仿 PuTTY / Windows Terminal）────────────────
    // 选中即复制：鼠标松开时若有选区，写入剪贴板（免 Ctrl+C）。仅在安全上下文有 clipboard API。
    const onMouseUp = () => {
      if (!term.hasSelection()) return;
      const sel = term.getSelection();
      if (sel) void navigator.clipboard?.writeText(sel).catch(() => {});
    };
    // 右键粘贴：拦掉浏览器右键菜单（preventDefault）→ 读剪贴板 → 送 stdin。
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      void navigator.clipboard
        ?.readText()
        .then((text) => {
          if (text) wsRef.current?.send(text);
        })
        .catch(() => {});
    };
    el.addEventListener("mouseup", onMouseUp);
    el.addEventListener("contextmenu", onContextMenu);

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
      searchRef.current = null;
      safeFitRef.current = null;
      observer.disconnect();
      cancelLongPress();
      el.removeEventListener("touchstart", onTouchStart, { capture: true });
      el.removeEventListener("touchmove", onTouchMove, { capture: true });
      el.removeEventListener("touchend", onTouchEnd, { capture: true });
      el.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("contextmenu", onContextMenu);
      dataDisposable.dispose();
      ws.close();
      // 先拆传输/监听，再 core.dispose()（内部按序：主题 observer → WebGL → term.dispose）
      core.dispose();
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
