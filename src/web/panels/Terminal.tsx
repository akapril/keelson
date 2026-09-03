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
import { toast } from "sonner";
import { XtermView, type XtermHandle } from "@/components/terminal/XtermView";
import type { WsStatus } from "@/web/webterm-ws";
import type { Session } from "@/types/session";
import { KeyboardIcon, PasteIcon, SearchIcon, RestartIcon } from "./icons";

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
  { label: "Ctrl-L",  bytes: "\x0c",   title: "Clear screen (Ctrl-L)" },
  { label: "Ctrl-Z",  bytes: "\x1a",   title: "Suspend (Ctrl-Z)" },
  { label: "Tab",     bytes: "\t",     title: "Tab / autocomplete" },
  { label: "⇧Tab",   bytes: "\x1b[Z", title: "Shift-Tab" },
  { label: "↑",       bytes: "\x1b[A", title: "Arrow Up" },
  { label: "↓",       bytes: "\x1b[B", title: "Arrow Down" },
  { label: "←",       bytes: "\x1b[D", title: "Arrow Left" },
  { label: "→",       bytes: "\x1b[C", title: "Arrow Right" },
  { label: "Home",    bytes: "\x1b[H", title: "Home" },
  { label: "End",     bytes: "\x1b[F", title: "End" },
  { label: "PgUp",    bytes: "\x1b[5~", title: "Page Up" },
  { label: "PgDn",    bytes: "\x1b[6~", title: "Page Down" },
  { label: "Enter",   bytes: "\r",     title: "Enter / confirm" },
] as const;

interface VirtualKeybarProps {
  /** 调用此方法向 pty stdin 发送字节 */
  onSend: (data: string) => void;
  /** 点「键盘」→ 显式弹出软键盘（默认点终端不弹，避免挡界面） */
  onShowKeyboard: () => void;
  /** 点「粘贴」→ 读剪贴板并作为 stdin 发送 */
  onPaste: () => void;
  /** 调整字号（delta 正=放大/负=缩小） */
  onAdjustFont: (delta: number) => void;
}

/**
 * 虚拟按键条（移动端显示，桌面 lg: 隐藏）
 * - 首位为「键盘」：默认点终端不弹软键盘（可滚动不挡界面），要打字点它才弹
 * - 横向可滚动，避免在窄屏挤压按钮；按钮触摸友好的 min-w + h
 * - 历史滚动改由终端区**直接触摸滑动**；复制历史改由**长按终端**打开可选文本层（不再放按钮）
 */
function VirtualKeybar({ onSend, onShowKeyboard, onPaste, onAdjustFont }: VirtualKeybarProps) {
  const { t } = useTranslation("web");
  const btnCls =
    "flex min-w-[2.5rem] shrink-0 items-center justify-center rounded border border-border bg-background px-2 py-1.5 text-xs font-mono text-foreground transition-colors active:bg-muted hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div
      className="shrink-0 overflow-x-auto border-t border-border bg-muted/40 py-1.5 lg:hidden"
      aria-label={t("terminal.virtualKeys.label")}
      role="toolbar"
    >
      <div className="flex gap-1 px-2">
        {/* 键盘按钮：点它才弹软键盘 */}
        <button
          type="button"
          title={t("terminal.keyboard")}
          aria-label={t("terminal.keyboard")}
          onClick={onShowKeyboard}
          className={`${btnCls} border-primary/40 text-primary`}
        >
          <KeyboardIcon className="size-4" />
        </button>
        {/* 粘贴：读剪贴板 → stdin */}
        <button
          type="button"
          title={t("terminal.paste")}
          aria-label={t("terminal.paste")}
          onClick={onPaste}
          className={btnCls}
        >
          <PasteIcon className="size-4" />
        </button>
        {/* 字号缩小 / 放大 */}
        <button
          type="button"
          title={t("terminal.fontDec")}
          aria-label={t("terminal.fontDec")}
          onClick={() => onAdjustFont(-1)}
          className={btnCls}
        >
          A-
        </button>
        <button
          type="button"
          title={t("terminal.fontInc")}
          aria-label={t("terminal.fontInc")}
          onClick={() => onAdjustFont(1)}
          className={btnCls}
        >
          A+
        </button>
        <span className="mx-0.5 shrink-0 self-stretch border-l border-border" aria-hidden />
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
  /** 已打开的终端会话列表（多终端 tab） */
  terminals: Session[];
  /** 当前活动终端 session_id */
  activeId: string | null;
  /** 切换活动终端 */
  onSelect: (id: string) => void;
  /** 关闭某终端 tab（断该 WS；后端 PTY 仍在，可再打开重连） */
  onClose: (id: string) => void;
}

/**
 * 单个终端实例：XtermView + 连接态角标 + 虚拟按键条。
 * keep-alive：非活动时 `hidden`（display:none）而非卸载 → WS 不断、xterm 缓冲不丢
 * （配合后端持久化，切 tab / 刷新都无损续接）。
 */
function TerminalInstance({ session, active }: { session: Session; active: boolean }) {
  const { t } = useTranslation("web");
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  // 文本浮层内容（null=关闭）：倒出终端缓冲文本，原生平滑滚 + 长按选择复制
  const [textView, setTextView] = useState<string | null>(null);
  // 搜索栏开合 + 查询词（回滚缓冲查找，见 XtermHandle.findNext）
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // 进程已退出（收到 exit 帧）：显示「重启」入口
  const [exited, setExited] = useState(false);
  // 重启代际：递增即让 XtermView 重挂（新 WS → 后端重新 open/resume 同会话 PTY）
  const [restartGen, setRestartGen] = useState(0);
  const xtermRef = useRef<XtermHandle>(null);
  const copyAll = () => {
    if (textView == null) return;
    void navigator.clipboard.writeText(textView).then(
      () => toast.success(t("terminal.copied")),
      () => toast.error(t("terminal.copyError")),
    );
  };
  // 粘贴：读剪贴板 → 作为 stdin 发送（https/localhost 下可用；被拒则提示）
  const pasteFromClipboard = () => {
    void navigator.clipboard.readText().then(
      (text) => {
        if (text) xtermRef.current?.sendInput(text);
      },
      () => toast.error(t("terminal.pasteError")),
    );
  };
  // 重启：清退出态 + 递增代际（触发 XtermView 重挂重连）
  const restart = () => {
    setExited(false);
    setWsStatus("connecting");
    setRestartGen((g) => g + 1);
  };
  // 关闭搜索：收起 + 清空 + 清除终端高亮
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    xtermRef.current?.clearSearch();
  };
  return (
    <div className={active ? "absolute inset-0 flex flex-col" : "hidden"}>
      {/* 顶栏：provider + 连接态 + 搜索/重启（会话名在上方 tab 栏） */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="truncate text-xs text-muted-foreground" title={session.project_path}>
          {t("terminal.header.provider", { provider: session.provider })}
        </span>
        <div className="flex items-center gap-2">
          {/* 进程已退出 → 一键重启（重挂重连，后端 resume 同会话） */}
          {exited && (
            <button
              type="button"
              onClick={restart}
              className="flex items-center gap-1 rounded border border-primary/40 bg-background px-2 py-0.5 text-xs font-medium text-primary hover:bg-muted"
            >
              <RestartIcon className="size-3.5" /> {t("terminal.restart")}
            </button>
          )}
          {/* 搜索开关 */}
          <button
            type="button"
            title={t("terminal.search")}
            aria-label={t("terminal.search")}
            aria-pressed={searchOpen}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            className={`flex items-center rounded border px-2 py-1 hover:bg-muted ${
              searchOpen ? "border-primary/40 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            <SearchIcon className="size-3.5" />
          </button>
          <StatusBadge status={wsStatus} />
        </div>
      </div>
      {/* 搜索栏：查回滚缓冲。输入即高亮首个匹配；↑↓ 上/下一个；✕ 关闭清高亮 */}
      {searchOpen && (
        <div className="flex shrink-0 items-center gap-1 border-b border-border bg-muted/30 px-2 py-1">
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              xtermRef.current?.findNext(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) xtermRef.current?.findPrevious(searchQuery);
                else xtermRef.current?.findNext(searchQuery);
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              }
            }}
            placeholder={t("terminal.searchPlaceholder")}
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            title={t("terminal.searchPrev")}
            aria-label={t("terminal.searchPrev")}
            onClick={() => xtermRef.current?.findPrevious(searchQuery)}
            className="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
          >
            ↑
          </button>
          <button
            type="button"
            title={t("terminal.searchNext")}
            aria-label={t("terminal.searchNext")}
            onClick={() => xtermRef.current?.findNext(searchQuery)}
            className="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
          >
            ↓
          </button>
          <button
            type="button"
            aria-label={t("terminal.close")}
            onClick={closeSearch}
            className="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
          >
            ✕
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden bg-background">
        <XtermView
          key={restartGen}
          ref={xtermRef}
          sessionId={session.session_id}
          provider={session.provider}
          projectPath={session.project_path}
          onStatusChange={setWsStatus}
          onExit={() => setExited(true)}
          onLongPress={() => setTextView(xtermRef.current?.getText() ?? "")}
          className="size-full"
        />
      </div>
      {/* 虚拟按键条：仅移动端显示（lg:hidden）。历史滚动=触摸滑动；复制历史=长按终端开文本层 */}
      <VirtualKeybar
        onSend={(d) => xtermRef.current?.sendInput(d)}
        onShowKeyboard={() => xtermRef.current?.focusKeyboard()}
        onPaste={pasteFromClipboard}
        onAdjustFont={(delta) => xtermRef.current?.adjustFontSize(delta)}
      />

      {/* 文本浮层：纯文本 = 原生平滑滚动 + 长按选择复制，绕开 canvas 选区之难 */}
      {textView != null && (
        <div className="absolute inset-0 z-30 flex flex-col bg-background">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="text-sm font-medium">{t("terminal.viewCopy")}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyAll}
                className="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
              >
                {t("terminal.copyAll")}
              </button>
              <button
                type="button"
                onClick={() => setTextView(null)}
                aria-label={t("terminal.close")}
                className="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
              >
                {t("terminal.close")}
              </button>
            </div>
          </div>
          {/* 纯文本区：可原生选择、平滑滚动；等宽字体保持终端观感 */}
          <pre className="min-h-0 flex-1 select-text overflow-auto whitespace-pre px-3 py-2 font-mono text-xs leading-relaxed">
            {textView || t("terminal.empty.hint")}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * 终端面板（多 tab）：
 *   - 空列表 → 空态提示
 *   - 否则 → 终端 tab 栏（移动端横向滚动）+ 各实例常驻挂载切显隐
 */
export function Terminal({ terminals, activeId, onSelect, onClose }: TerminalPanelProps) {
  if (terminals.length === 0) {
    return <EmptyState />;
  }
  return (
    <div className="flex h-full flex-col">
      {/* 终端 tab 栏：多终端切换，窄屏横向滚动，不再挤 */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1">
        {terminals.map((s) => {
          const isActive = s.session_id === activeId;
          return (
            <div
              key={s.session_id}
              className={`flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(s.session_id)}
                className="max-w-[8rem] truncate"
                title={s.project_path}
              >
                {s.project_name}
              </button>
              <button
                type="button"
                onClick={() => onClose(s.session_id)}
                aria-label="close"
                className="shrink-0 rounded px-1 leading-none hover:bg-background hover:text-foreground"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* 内容区：所有实例常驻挂载，仅切显隐（keep-alive） */}
      <div className="relative min-h-0 flex-1">
        {terminals.map((s) => (
          <TerminalInstance key={s.session_id} session={s} active={s.session_id === activeId} />
        ))}
      </div>
    </div>
  );
}
