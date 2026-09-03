// web/panels/Workbench.tsx — 工作台栏：会话列表（Task 8）
// 职责：调 ipc.listSessions()（web 环境自动走 /api/sessions_list），渲染最近会话卡片列表。
// 移动优先卡片布局；点击会话触发 onOpenTerminal 回调（终端内容 Task 13 接管）。

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";
import type { Session } from "@/types/session";
import { SessionTranscript } from "./SessionTranscript";

// ── 纯工具函数 ────────────────────────────────────────────────

/** 截断字符串至 maxLen，超出用省略号 */
function truncate(text: string, maxLen = 80): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "…";
}

/** 计算相对时间（刚刚/N 分钟/小时/天前/MM-DD）；解析失败返回空串 */
function relativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Math.max(0, now - t);
  const min = 60_000, hour = 3_600_000, day = 86_400_000;
  if (diff < min) return "just now";
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── 子组件：单条会话卡片 ──────────────────────────────────────

interface SessionRowProps {
  session: Session;
  onOpenTerminal: (session: Session) => void;
  onViewTranscript: (session: Session) => void;
}

function SessionRow({ session, onOpenTerminal, onViewTranscript }: SessionRowProps) {
  const { t } = useTranslation("web");
  const relTime = relativeTime(session.updated_at);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${session.project_name} — ${session.last_prompt || session.first_prompt}`}
      onClick={() => onOpenTerminal(session)}
      onKeyDown={(e) => e.key === "Enter" && onOpenTerminal(session)}
      className="flex cursor-pointer flex-col gap-1.5 rounded-lg border border-border bg-card p-3 text-left text-card-foreground transition-colors hover:bg-accent/50 active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* 首行：项目名 + 相对时间 */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium"
          title={session.project_path}
        >
          {session.project_name}
        </span>
        {relTime && (
          <span className="shrink-0 text-xs text-muted-foreground" title={session.updated_at}>
            {relTime}
          </span>
        )}
      </div>

      {/* 第二行：provider 徽章 + 消息数 + 「记录」入口 */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{session.provider}</span>
        <span>{t("workbench.session.messages", { count: session.message_count })}</span>
        {/* 记录：读完整对话记录（只读、可复制）。stopPropagation 避免触发整卡片的开终端 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onViewTranscript(session);
          }}
          className="ml-auto rounded border border-border px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
        >
          📄 {t("transcript.view")}
        </button>
      </div>

      {/* 第三行：最后一条 prompt 截断 */}
      {(session.last_prompt || session.first_prompt) && (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {truncate(session.last_prompt || session.first_prompt)}
        </p>
      )}
    </div>
  );
}

// ── 加载骨架屏 ────────────────────────────────────────────────

function SessionSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3" aria-hidden>
      <div className="flex items-center justify-between gap-2">
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-3 w-10 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex items-center gap-2">
        <div className="h-4 w-12 animate-pulse rounded bg-muted" />
        <div className="h-3 w-16 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-8 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────

export interface WorkbenchProps {
  /** 点击会话时的回调：切到终端栏（Task 13 实现终端内容；本 Task 仅触发 tab 切换） */
  onOpenTerminal: (session: Session) => void;
}

/**
 * 工作台栏（Task 8）：展示本地 CLI 会话列表。
 * - 数据：ipc.listSessions()，Tauri 环境走 invoke，web 环境走 POST /api/sessions_list。
 * - 移动优先卡片列表，无硬编色，WCAG 2.1 AA 键盘可访问。
 * - 三态：加载中 / 空态（含提示文案） / 会话列表。
 * - 加载失败 → toast 错误 + 展示错误占位。
 */
export function Workbench({ onOpenTerminal }: WorkbenchProps) {
  const { t } = useTranslation("web");

  type LoadState = "loading" | "empty" | "loaded" | "error";
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [sessions, setSessions] = useState<Session[]>([]);
  // 当前正在查看记录的会话（null=未打开记录浮层）
  const [transcriptSession, setTranscriptSession] = useState<Session | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");

    ipc
      .listSessions()
      .then((data) => {
        if (cancelled) return;
        // 按 updated_at 倒序（最近活跃排前）
        const sorted = [...data].sort(
          (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
        );
        setSessions(sorted);
        setLoadState(sorted.length === 0 ? "empty" : "loaded");
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[Workbench] 加载会话失败:", err);
        toast.error(t("workbench.errorHint"));
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="relative flex h-full flex-col">
      {/* 标题行 */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{t("workbench.title")}</h2>
      </div>

      {/* 内容区：可滚动列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loadState === "loading" && (
          <div className="flex flex-col gap-2" role="status" aria-label={t("workbench.loading")}>
            <SessionSkeleton />
            <SessionSkeleton />
            <SessionSkeleton />
          </div>
        )}

        {(loadState === "empty" || loadState === "error") && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center">
            <p className="text-sm font-medium text-foreground">
              {loadState === "error" ? t("workbench.errorHint") : t("workbench.empty")}
            </p>
            {loadState === "empty" && (
              <p className="max-w-xs text-xs text-muted-foreground">{t("workbench.emptyHint")}</p>
            )}
          </div>
        )}

        {loadState === "loaded" && (
          <ul className="flex flex-col gap-2" role="list" aria-label={t("workbench.title")}>
            {sessions.map((session) => (
              <li key={`${session.provider}:${session.session_id}`}>
                <SessionRow
                  session={session}
                  onOpenTerminal={onOpenTerminal}
                  onViewTranscript={setTranscriptSession}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 会话记录浮层：读完整对话记录，只读展示 + 复制全部 */}
      {transcriptSession && (
        <SessionTranscript
          session={transcriptSession}
          onClose={() => setTranscriptSession(null)}
        />
      )}
    </div>
  );
}
