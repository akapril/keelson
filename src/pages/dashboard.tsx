// 首页总览 Dashboard —— 把会话 / 看板 / 阅读 / 日历聚合到一处，各项可点跳转。
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { Analytics01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { providerMeta } from "@/lib/providers";
import { focusRing } from "@/lib/focus-ring";
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
  // 首帧加载标志：区分「未加载」与「加载完确为空」。否则初值空数组会让首帧必命中 length===0，
  // 先闪『暂无…』+ 统计卡显 0，数据到达再 pop，给「数据丢了」的错觉。载完前一律显骨架。
  const [loaded, setLoaded] = useState(false);

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
    // 全部初始加载 settle（成败不论）后置 loaded=true，届时才允许显示空态/真实统计数字
    void Promise.allSettled([
      useSessionsStore.getState().load(),
      useBoardStore.getState().loadProjects(),
      listDueTasks().then(setTasks),
      listEvents().then(setEvents),
      listReadingItems().then(setReading),
    ]).finally(() => setLoaded(true));
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
  // 近期事件只显示**设了提醒的日程**（remind_at 非空）：纯流水账（记"刚才做了什么"、不提醒）
  // 不挤进近期事件（与项目概览「近期事件」口径一致）。
  const upcomingEvents = useMemo(
    () =>
      events
        .filter((e) => e.remind_at && new Date(e.end || e.start).getTime() >= today)
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
            className={`shrink-0 rounded text-xs text-muted-foreground hover:text-foreground ${focusRing}`}
          >
            {t("dashboard.mcpHintDismiss")}
          </button>
        </div>
      )}

      {/* 统计卡片（载入前数字位显骨架条，避免先闪 0 再跳真实值） */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("dashboard.statProjects")} value={projects.length} loading={!loaded} onClick={() => navigate("/board")} />
        <StatCard label={t("dashboard.statSessions")} value={sessions.length} loading={!loaded} onClick={() => navigate("/sessions")} />
        <StatCard label={t("dashboard.statUnreadReading")} value={unreadCount} loading={!loaded} onClick={() => navigate("/reading")} />
        <StatCard
          label={t("dashboard.statUpcoming")}
          value={upcomingEvents.length}
          loading={!loaded}
          onClick={() => navigate("/calendar")}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 近期会话 */}
        <Panel title={t("dashboard.panelRecentSessions")} onMore={() => navigate("/sessions")}>
          {!loaded ? (
            <PanelSkeleton />
          ) : recentSessions.length === 0 ? (
            <Empty text={t("dashboard.panelEmptySessions")} />
          ) : (
            recentSessions.map((s) => (
              <Row
                key={s.session_id}
                onClick={() => navigate(`/sessions?session=${s.session_id}`)}
                title={s.project_name}
                sub={s.last_prompt || s.first_prompt || undefined}
                meta={providerMeta(s.provider).label}
                action={
                  <button
                    type="button"
                    title={t("sessions:card.restore")}
                    onClick={() => void resumeSession(s.session_id)}
                    className={`flex size-5 items-center justify-center rounded text-primary/80 transition-colors hover:bg-accent hover:text-primary ${focusRing}`}
                  >
                    <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />
                  </button>
                }
              />
            ))
          )}
        </Panel>

        {/* 近期截止任务：无数据时折叠成一行入口（恒空面板本身是缺陷；多数任务不设截止） */}
        {loaded && upcomingTasks.length === 0 ? (
          <CollapsedPanel title={t("dashboard.panelRecentDue")} hint={t("dashboard.collapsedBoard")} onClick={() => navigate("/board")} />
        ) : (
          <Panel title={t("dashboard.panelRecentDue")} onMore={() => navigate("/board")}>
            {!loaded ? (
              <PanelSkeleton />
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
        )}

        {/* 近期事件 */}
        {loaded && upcomingEvents.length === 0 ? (
          <CollapsedPanel title={t("dashboard.panelRecentEvents")} hint={t("dashboard.collapsedCalendar")} onClick={() => navigate("/calendar")} />
        ) : (
          <Panel title={t("dashboard.panelRecentEvents")} onMore={() => navigate("/calendar")}>
            {!loaded ? (
              <PanelSkeleton />
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
        )}

        {/* 阅读队列 */}
        {loaded && readingQueue.length === 0 ? (
          <CollapsedPanel title={t("dashboard.panelReadingQueue")} hint={t("dashboard.collapsedReading")} onClick={() => navigate("/reading")} />
        ) : (
          <Panel title={t("dashboard.panelReadingQueue")} onMore={() => navigate("/reading")}>
            {!loaded ? (
              <PanelSkeleton />
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
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
  onClick,
}: {
  label: string;
  value: number;
  /** 首帧未载完：数字位显骨架条而非 0，避免先闪 0 再跳真实值 */
  loading?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40 ${focusRing}`}
    >
      {loading ? (
        <div className="h-8 w-8 animate-pulse rounded bg-muted" />
      ) : (
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      )}
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </button>
  );
}

/** 面板加载骨架：3 行透明度呼吸占位条，避免加载态「一行灰字→数据到达布局跳变」。 */
function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-2 py-1">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-8 animate-pulse rounded-lg bg-muted/60" />
      ))}
    </div>
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
            className={`rounded text-xs text-muted-foreground hover:text-foreground ${focusRing}`}
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
        // 有 action 才留右侧 pr-8 给悬停动作，否则 pr-2 让 meta 右对齐不白缩 32px
        className={`flex w-full items-center gap-2 rounded-lg py-1.5 pl-1.5 text-left hover:bg-muted ${action ? "pr-8" : "pr-2"} ${focusRing}`}
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

/** 折叠面板：某原生面板无数据时收成一行入口（标题 + 引导 CTA），不占满格空白。 */
function CollapsedPanel({
  title,
  hint,
  onClick,
}: {
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-left transition-colors hover:bg-accent/40 ${focusRing}`}
    >
      <span className="text-sm font-medium text-muted-foreground">{title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{hint} →</span>
    </button>
  );
}
