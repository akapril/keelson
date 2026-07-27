// 自建标题栏（decorations:false 后替代原生标题栏）。
// 顶部细条：可拖拽区（data-tauri-drag-region，双击最大化/还原）+ 窗口控制按钮。
// 控件用内联 SVG，零图标依赖。仅主窗口渲染（spotlight 无标题栏）。
import { getCurrentWindow } from "@tauri-apps/api/window";

const win = getCurrentWindow();

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
      <line x1="0" y1="5.5" x2="10" y2="5.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
function MaximizeIcon() {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
      <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
      <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function TitleBar() {
  return (
    <div
      data-tauri-drag-region
      className="flex h-8 shrink-0 select-none items-center justify-between border-b border-border bg-background"
    >
      {/* 左：应用名（同为拖拽区） */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 pl-3 text-xs font-medium text-muted-foreground"
      >
        Keelson
      </div>

      {/* 右：窗口控制 */}
      <div className="flex h-full">
        <button
          type="button"
          aria-label="最小化"
          onClick={() => void win.minimize()}
          className="inline-flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MinimizeIcon />
        </button>
        <button
          type="button"
          aria-label="最大化 / 还原"
          onClick={() => void win.toggleMaximize()}
          className="inline-flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MaximizeIcon />
        </button>
        <button
          type="button"
          aria-label="关闭"
          onClick={() => void win.close()}
          className="inline-flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-white"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
