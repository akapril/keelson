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
 */
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { openTerminalWs, type WsStatus } from "@/web/webterm-ws";

/** 从 CSS 变量解析终端主题色（语义色 → xterm 主题映射） */
function resolveXtermTheme(): {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
} {
  const style = getComputedStyle(document.documentElement);
  // 优先取自定义 CSS 变量，fallback 到中性深色值（保持可读）
  const bg = style.getPropertyValue("--background").trim() || "#1a1b1e";
  const fg = style.getPropertyValue("--foreground").trim() || "#c9d1d9";
  const muted =
    style.getPropertyValue("--muted-foreground").trim() || "#8b949e";
  const primary =
    style.getPropertyValue("--primary").trim() || "#58a6ff";

  // CSS 变量值可能是 "oklch(...)" 或 HEX，xterm 要求合法 CSS 色值即可
  return {
    background: cssVarToColor(bg, "#1a1b1e"),
    foreground: cssVarToColor(fg, "#c9d1d9"),
    cursor: cssVarToColor(primary, "#58a6ff"),
    selectionBackground: cssVarToColor(muted, "#3d444d") + "40", // 25% alpha
  };
}

/**
 * 将 CSS 变量值转换为 xterm 可接受的色值字符串。
 * Tailwind v4 使用 oklch()，xterm 支持标准 CSS 颜色，直接透传即可。
 * 若值为空白或无法判断，返回 fallback。
 */
function cssVarToColor(value: string, fallback: string): string {
  const v = value.trim();
  if (!v) return fallback;
  // oklch / hsl / rgb / #hex 均直接返回（xterm 底层 canvas 用 CSS 解析）
  return v;
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
 */
export function XtermView({
  sessionId,
  provider,
  projectPath,
  onExit,
  onStatusChange,
  className,
}: XtermViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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

    // 渲染到 DOM
    term.open(containerRef.current);
    fitAddon.fit();

    // 连接 WS
    const ws = openTerminalWs(
      sessionId,
      { provider, path: projectPath },
      {
        onData(bytes) {
          term.write(bytes);
        },
        onExit() {
          term.writeln("\r\n\x1b[2m[process exited]\x1b[0m");
          onExit?.();
        },
        onStatus(s) {
          onStatusChange?.(s);
        },
      }
    );

    // 键盘输入 → stdin（term.onData 发出 xterm 解码后的字符序列）
    const dataDisposable = term.onData((str) => {
      ws.send(str);
    });

    // 容器尺寸变化 → fit + resize 帧
    const observer = new ResizeObserver(() => {
      // fit() 内部会重新计算 cols/rows
      fitAddon.fit();
      ws.resize(term.cols, term.rows);
    });
    observer.observe(containerRef.current);

    // 清理：卸载时释放所有资源
    return () => {
      observer.disconnect();
      dataDisposable.dispose();
      ws.close();
      term.dispose();
    };
  }, [sessionId, provider, projectPath, onExit, onStatusChange]);

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
}
