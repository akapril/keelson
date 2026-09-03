/**
 * xterm-shared.ts — 共享 xterm 工具函数
 *
 * 供 XtermView（web 终端）和 InteractivePtyView（交互式 PTY 终端）复用。
 * 职责：主题解析 + 安全 fit 工厂（keep-alive 布局保护）+ WebGL 渲染器加载。
 */
import type { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";

/**
 * 将 CSS 变量值转换为 xterm 可接受的色值字符串。
 * Tailwind v4 使用 oklch()，xterm 支持标准 CSS 颜色，直接透传即可。
 * 若值为空白或无法判断，返回 fallback。
 */
export function cssVarToColor(value: string, fallback: string): string {
  const v = value.trim();
  if (!v) return fallback;
  // oklch / hsl / rgb / #hex 均直接返回（xterm 底层 canvas 用 CSS 解析）
  return v;
}

/** 从 CSS 变量解析终端主题色（语义色 → xterm 主题映射） */
export function resolveXtermTheme(): {
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
 * 生成 safeFit：容器可见（有实际尺寸）时才 fit，避免 keep-alive 布局下容器
 * display:none（0 尺寸）时被 fit 成 1x1 破坏终端。返回是否真正执行了 fit。
 *
 * @param getContainer 返回终端挂载容器元素的函数（通常为 () => containerRef.current）
 * @param fit 执行实际 fit 的函数（通常为 () => fitAddon.fit()）
 * @returns 无参函数，调用时检查容器尺寸：可见则 fit 并返回 true，不可见返回 false
 */
export function makeSafeFit(
  getContainer: () => HTMLElement | null,
  fit: () => void,
): () => boolean {
  return () => {
    const el = getContainer();
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) return false;
    fit();
    return true;
  };
}

/**
 * 尝试为终端启用 WebGL 硬件加速渲染。
 *
 * 相比 xterm 默认 DOM 渲染，WebGL 在整帧重绘/快速滚动时流畅度大幅提升——
 * claude/codex 等全屏 TUI 频繁整屏重绘时尤其明显，直接缓解移动端"滚动不丝滑"。
 *
 * 健壮性：
 * - 必须在 `term.open()` 之后调用（此时渲染层已就绪）。
 * - WebGL 不可用（无 GL 上下文 / 驱动黑名单 / 软件渲染禁用）时 try/catch 静默失败，
 *   回退默认渲染，绝不阻断终端使用。
 * - 监听 `onContextLoss`（GPU 上下文丢失，如切后台/驱动重置）→ dispose 坏渲染器，
 *   xterm 自动退回 DOM 渲染，避免留下黑屏/花屏。
 *
 * @returns 清理函数（组件卸载时调用以 dispose 插件）；未启用时为 noop。
 */
export function loadWebglRenderer(term: Terminal): () => void {
  try {
    const addon = new WebglAddon();
    // 上下文丢失即弃用该渲染器（回退 DOM），不再继续用坏的 GL 上下文绘制。
    addon.onContextLoss(() => addon.dispose());
    term.loadAddon(addon);
    return () => addon.dispose();
  } catch {
    // WebGL 初始化失败：保持默认渲染，返回 noop 清理。
    return () => {};
  }
}
