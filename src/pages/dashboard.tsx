// 首页总览 Dashboard —— 把会话 / 看板 / 阅读 / 日历聚合到一处，各项可点跳转。
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { Analytics01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useSessionsStore } from "@/store/sessions";
import { useRestoreStore } from "@/store/restore";
import { useBoardStore } from "@/store/board";
import { listDueTasks } from "@/lib/pb/board";
import { listEvents } from "@/lib/pb/calendar";
import { listReadingItems } from "@/lib/pb/reading";
import { workspaceRecordUrl } from "@/lib/workspace-navigation";
import type { BoardTask } from "@/types/board";
import type { CalendarEvent } from "@/types/calendar";
import type { ReadingItem } from "@/types/reading";
import i18n from "@/i18n";

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function fmtDay(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(i18n.language, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export default function Dashboard() {
  const { t } = useTranslation("shell");
  const navigate = useNavigate();
  const sessions = useSessionsStore((s) => s.sessions);
  const projects = useBoardStore((s) => s.projects);
  const resume = useRestoreStore((s) => s.resume);

  // 近期会话行 hover 一键接续（走全局新窗/标签偏好），与侧栏收藏行交互对齐
  const resumeSession = async (sessionId: string) => {
    const s = sessions.find((x) => x.session_id === sessionId);
    if (!s) return;
    await resume(s);
    const err = useRestoreStore.getState().error;
    if (err) toast.error(t("sessions:card.toast.restoreError", { msg: err }));
  };

  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [reading, setReading] = useState<ReadingItem[]>([]);

  // 首次引导：提示接入 MCP（核心受众 CLI 用户的杀手级功能，否则埋在设置里易错过）。
  // 可永久关闭；关闭态存 localStorage。
  const [mcpHintDismissed, setMcpHintDismissed] = useState(() => {
    try {
      return !!localStorage.getItem("keelson-mcp-hint-dismissed");
    } catch {
      return false;
    }
  });
  const dismissMcpHint = () => {
    try {
      localStorage.setItem("keelson-mcp-hint-dismissed", "1");
    } catch {
      /* ignore */
    }
    setMcpHintDismissed(true);
  };

  useEffect(() => {
    useSessionsStore.getState().load();
    useBoardStore.getState().loadProjects();
    void listDueTasks().then(setTasks).catch(() => {});
    void listEvents().then(setEvents).catch(() => {});
    void listReadingItems().then(setReading).catch(() => {});
  }, []);

  const today = startOfToday();

  const recentSessions = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1))
        .slice(0, 6),
    [sessions],
  );
  const upcomingTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.due_date && new Date(t.due_date).getTime() >= today)
        .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""))
        .slice(0, 6),
    [tasks, today],
  );
  const upcomingEvents = useMemo(
    () =>
      events
        .filter((e) => new Date(e.end || e.start).getTime() >= today)
        .sort((a, b) => (a.start || "").localeCompare(b.start || ""))
        .slice(0, 6),
    [events, today],
  );
  const readingQueue = useMemo(
    () => reading.filter((r) => r.status !== "archived").slice(0, 6),
    [reading],
  );

  const unreadCount = reading.filter((r) => r.status === "unread").length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("dashboard.title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("nav.dashboard.description")}
          </p>
        </div>
        {/* 工作报告入口（低频动作，不占侧栏，从这里进） */}
        <Button variant="outline" size="sm" onClick={() => navigate("/report")}>
          <HugeiconsIcon icon={Analytics01Icon} strokeWidth={2} />
          {t("commandPalette.actionReport")}
        </Button>
      </header>

      {/* 首次引导：一键接入 claude / codex（可关闭） */}
      {!mcpHintDismissed && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-medium text-foreground">{t("dashboard.mcpHintTitle")}</span>
            <span className="ml-1 text-muted-foreground">{t("dashboard.mcpHintBody")}</span>
          </span>
          <Button size="sm" onClick={() => navigate("/settings?section=mcp")}>
            {t("dashboard.mcpHintCta")}
          </Button>
          <button
            type="button"
            onClick={dismissMcpHint}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            {t("dashboard.mcpHintDismiss")}
          </button>
        </div>
      )}

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("dashboard.statProjects")} value={projects.length} onClick={() => navigate("/board")} />
        <StatCard label={t("dashboard.statSessions")} value={sessions.length} onClick={() => navigate("/sessions")} />
        <StatCard label={t("dashboard.statUnreadReading")} value={unreadCount} onClick={() => navigate("/reading")} />
        <StatCard
          label={t("dashboard.statUpcoming")}
          value={upcomingEvents.length}
          onClick={() => navigate("/calendar")}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 近期会话 */}
        <Panel title={t("dashboard.panelRecentSessions")} onMore={() => navigate("/sessions")}>
          {recentSessions.length === 0 ? (
            <Empty text={t("dashboard.panelEmptySessions")} />
          ) : (
            recentSessions.map((s) => (
              <Row
                key={s.session_id}
                onClick={() => navigate(`/sessions?session=${s.session_id}`)}
                title={s.project_name}
                sub={s.last_prompt || s.first_prompt || s.session_id}
                meta={s.provider}
                action={
                  <button
                    type="button"
                    title={t("sessions:card.restore")}
                    onClick={() => void resumeSession(s.session_id)}
                    className="flex size-5 items-center justify-center rounded text-primary/80 transition-colors hover:bg-accent hover:text-primary"
                  >
                    <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />
                  </button>
                }
              />
            ))
          )}
        </Panel>

        {/* 近期截止任务 */}
        <Panel title={t("dashboard.panelRecentDue")} onMore={() => navigate("/board")}>
          {upcomingTasks.length === 0 ? (
            <Empty text={t("dashboard.panelEmptyDue")} />
          ) : (
            upcomingTasks.map((task) => (
              <Row
                key={task.id}
                onClick={() => navigate(workspaceRecordUrl("board", task.project))}
                title={task.title}
                meta={fmtDay(task.due_date)}
              />
            ))
          )}
        </Panel>

        {/* 近期事件 */}
        <Panel title={t("dashboard.panelRecentEvents")} onMore={() => navigate("/calendar")}>
          {upcomingEvents.length === 0 ? (
            <Empty text={t("dashboard.panelEmptyEvents")} />
          ) : (
            upcomingEvents.map((e) => (
              <Row
                key={e.id}
                onClick={() => navigate("/calendar")}
                title={e.title}
                meta={fmtDay(e.start)}
                dot={e.color || "var(--color-primary)"}
              />
            ))
          )}
        </Panel>

        {/* 阅读队列 */}
        <Panel title={t("dashboard.panelReadingQueue")} onMore={() => navigate("/reading")}>
          {readingQueue.length === 0 ? (
            <Empty text={t("dashboard.panelEmptyReading")} />
          ) : (
            readingQueue.map((r) => (
              <Row
                key={r.id}
                onClick={() => navigate("/reading")}
                title={r.title}
                meta={r.status === "unread" ? t("dashboard.statusUnread") : t("dashboard.statusReading")}
              />
            ))
          )}
        </Panel>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40"
    >
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </button>
  );
}

function Panel({
  title,
  onMore,
  children,
}: {
  title: string;
  onMore?: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation("common");
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {onMore && (
          <button
            type="button"
            onClick={onMore}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t("action.viewAll")}
          </button>
        )}
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function Row({
  title,
  sub,
  meta,
  dot,
  onClick,
  action,
}: {
  title: string;
  sub?: string;
  meta?: string;
  dot?: string;
  onClick?: () => void;
  /** 悬停时右侧浮现的动作（如「接续」箭头）；为 button 兄弟节点，避免按钮嵌套 */
  action?: React.ReactNode;
}) {
  return (
    <div className="group/row relative">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 pr-8 text-left hover:bg-muted"
      >
        {dot && (
          <span className="size-2 shrink-0 rounded-full" style={{ background: dot }} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{title}</span>
          {sub && (
            <span className="block truncate text-xs text-muted-foreground">{sub}</span>
          )}
        </span>
        {meta && (
          <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
        )}
      </button>
      {action && (
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover/row:opacity-100">
          {action}
        </div>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-xs text-muted-foreground">{text}</p>;
}
