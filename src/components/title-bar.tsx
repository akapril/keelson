// 自建标题栏（Windows/Linux：decorations:false 后替代原生标题栏）。
// 顶部细条：可拖拽区（data-tauri-drag-region，双击最大化/还原）+ 窗口控制按钮。
// 控件用内联 SVG，零图标依赖。主窗口与文档独立窗口渲染（spotlight 无标题栏）。
//
// macOS 例外：走原生红绿灯 overlay（tauri.macos.conf.json 里 titleBarStyle:"Overlay"），
// 系统在左上角浮出红绿灯，这里只留拖拽条并在左侧内缩避让，不自绘控制按钮。
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";

const win = getCurrentWindow();

// 平台探测：沿用项目既有的 userAgent 模式（零依赖、无需额外权限）。
const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);

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
  const { t } = useTranslation("shell");

  // macOS：原生红绿灯浮在左上角，这里只提供拖拽条并左侧内缩避让，不画控制按钮。
  if (IS_MAC) {
    return (
      <div
        data-tauri-drag-region
        className="flex h-8 shrink-0 select-none items-center border-b border-border bg-background pl-[72px] text-xs font-medium text-muted-foreground"
      >
        Keelson
      </div>
    );
  }

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
          aria-label={t("titleBar.minimize")}
          onClick={() => void win.minimize()}
          className="inline-flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MinimizeIcon />
        </button>
        <button
          type="button"
          aria-label={t("titleBar.maximize")}
          onClick={() => void win.toggleMaximize()}
          className="inline-flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MaximizeIcon />
        </button>
        <button
          type="button"
          aria-label={t("titleBar.close")}
          onClick={() => void win.close()}
          className="inline-flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-white"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
