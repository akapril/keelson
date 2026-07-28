/**
 * Terminal.tsx — Web 端终端栏（Task 13）
 *
 * 职责：
 *   - 有选中会话 → 渲染 XtermView + 连接态角标 + 虚拟按键条（移动优先）
 *   - 无选中会话 → 引导提示（从工作台选择会话）
 *
 * 布局：移动优先，终端区撑满，虚拟键条固定在底部（lg:hidden 桌面隐藏）。
 * 颜色：全部使用语义色 token，无硬编码 hex。
 * i18n：web namespace。
 */

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { XtermView, type XtermHandle } from "@/components/terminal/XtermView";
import type { WsStatus } from "@/web/webterm-ws";
import type { Session } from "@/types/session";

// ── 连接态角标 ────────────────────────────────────────────────

/** 根据 WsStatus 返回对应的 Tailwind 语义色类 */
function statusColorClass(status: WsStatus): string {
  switch (status) {
    case "connected":
      // 使用主色调表示"已连接/健康"状态
      return "bg-primary text-primary-foreground";
    case "connecting":
      // 与 reconnecting 共用警示色（amber 语义）
      return "bg-amber-500 text-white";
    case "reconnecting":
      return "bg-amber-500 text-white";
    case "closed":
      return "bg-muted text-muted-foreground";
  }
}

interface StatusBadgeProps {
  status: WsStatus;
}

/** 连接状态角标：小圆点 + 文字标签 */
function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation("web");
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusColorClass(status)}`}
      aria-live="polite"
      aria-label={t(`terminal.status.${status}`)}
    >
      {/* 小圆点指示灯 */}
      <span
        className={`size-1.5 rounded-full ${
          status === "connected"
            ? "bg-primary-foreground"
            : status === "closed"
              ? "bg-muted-foreground"
              : "animate-pulse bg-white"
        }`}
        aria-hidden
      />
      {t(`terminal.status.${status}`)}
    </span>
  );
}

// ── 虚拟按键条 ────────────────────────────────────────────────

/**
 * 控制键字节映射表
 * 注：方向键序列遵循 VT100/xterm ANSI 标准
 */
const VIRTUAL_KEYS = [
  { label: "ESC",      bytes: "\x1b",   title: "Escape" },
  { label: "Ctrl-C",  bytes: "\x03",   title: "Interrupt (Ctrl-C)" },
  { label: "Ctrl-D",  bytes: "\x04",   title: "EOF / logout (Ctrl-D)" },
  { label: "Tab",     bytes: "\t",     title: "Tab / autocomplete" },
  { label: "⇧Tab",   bytes: "\x1b[Z", title: "Shift-Tab" },
  { label: "↑",       bytes: "\x1b[A", title: "Arrow Up" },
  { label: "↓",       bytes: "\x1b[B", title: "Arrow Down" },
  { label: "←",       bytes: "\x1b[D", title: "Arrow Left" },
  { label: "→",       bytes: "\x1b[C", title: "Arrow Right" },
  { label: "Enter",   bytes: "\r",     title: "Enter / confirm" },
] as const;

interface VirtualKeybarProps {
  /** 调用此方法向 pty stdin 发送字节 */
  onSend: (data: string) => void;
}

/**
 * 虚拟按键条（移动端显示，桌面 lg: 隐藏）
 * - 横向可滚动，避免在窄屏挤压按钮
 * - 按钮使用触摸友好的 min-w + h 确保点击区域充足
 */
function VirtualKeybar({ onSend }: VirtualKeybarProps) {
  const { t } = useTranslation("web");
  return (
    <div
      className="shrink-0 overflow-x-auto border-t border-border bg-muted/40 py-1.5 lg:hidden"
      aria-label={t("terminal.virtualKeys.label")}
      role="toolbar"
    >
      <div className="flex gap-1 px-2">
        {VIRTUAL_KEYS.map(({ label, bytes, title }) => (
          <button
            key={label}
            type="button"
            title={title}
            aria-label={title}
            onClick={() => onSend(bytes)}
            className="flex min-w-[2.5rem] shrink-0 items-center justify-center rounded border border-border bg-background px-2 py-1.5 text-xs font-mono text-foreground transition-colors active:bg-muted hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 空态提示 ─────────────────────────────────────────────────

function EmptyState() {
  const { t } = useTranslation("web");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      {/* 终端图标（内联 SVG，无额外依赖） */}
      <svg
        className="size-10 text-muted-foreground"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M7 12l3-3-3 3 3 3M13 15h4" />
      </svg>
      <p className="text-sm font-medium text-foreground">
        {t("terminal.empty.title")}
      </p>
      <p className="max-w-xs text-xs text-muted-foreground">
        {t("terminal.empty.hint")}
      </p>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────

export interface TerminalPanelProps {
  /** 当前选中的会话（null 时展示空态提示） */
  session: Session | null;
}

/**
 * 终端栏（Task 13）：
 *   - session !== null → XtermView + 连接态角标 + 虚拟按键条
 *   - session === null → 空态提示
 */
export function Terminal({ session }: TerminalPanelProps) {
  const { t } = useTranslation("web");
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  // ref 用于从虚拟按键条调用 XtermView.sendInput()
  const xtermRef = useRef<XtermHandle>(null);

  /** 虚拟按键条点击 → 转发到 XtermView */
  function handleVirtualKey(data: string) {
    xtermRef.current?.sendInput(data);
  }

  if (!session) {
    return <EmptyState />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏：会话标题 + 连接态角标 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground" title={session.project_path}>
            {session.project_name}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("terminal.header.provider", { provider: session.provider })}
          </span>
        </div>
        <StatusBadge status={wsStatus} />
      </div>

      {/* 终端内容区：撑满剩余高度 */}
      <div className="min-h-0 flex-1 overflow-hidden bg-background">
        <XtermView
          ref={xtermRef}
          sessionId={session.session_id}
          provider={session.provider}
          projectPath={session.project_path}
          onStatusChange={setWsStatus}
          className="size-full"
        />
      </div>

      {/* 虚拟按键条：仅移动端显示（lg:hidden） */}
      <VirtualKeybar onSend={handleVirtualKey} />
    </div>
  );
}
