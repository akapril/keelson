// 首页总览 Dashboard —— 把会话 / 看板 / 阅读 / 日历聚合到一处，各项可点跳转。
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useSessionsStore } from "@/store/sessions";
import { useBoardStore } from "@/store/board";
import { listDueTasks } from "@/lib/pb/board";
import { listEvents } from "@/lib/pb/calendar";
import { listReadingItems } from "@/lib/pb/reading";
import { workspaceRecordUrl } from "@/lib/workspace-navigation";
import type { BoardTask } from "@/types/board";
import type { CalendarEvent } from "@/types/calendar";
import type { ReadingItem } from "@/types/reading";

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function fmtDay(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export default function Dashboard() {
  const navigate = useNavigate();
  const sessions = useSessionsStore((s) => s.sessions);
  const projects = useBoardStore((s) => s.projects);

  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [reading, setReading] = useState<ReadingItem[]>([]);

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
      <header>
        <h1 className="text-lg font-semibold">总览</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          会话、看板、阅读与日程一览。
        </p>
      </header>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="项目" value={projects.length} onClick={() => navigate("/board")} />
        <StatCard label="会话" value={sessions.length} onClick={() => navigate("/sessions")} />
        <StatCard label="未读阅读" value={unreadCount} onClick={() => navigate("/reading")} />
        <StatCard
          label="近期事件"
          value={upcomingEvents.length}
          onClick={() => navigate("/calendar")}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 近期会话 */}
        <Panel title="近期会话" onMore={() => navigate("/sessions")}>
          {recentSessions.length === 0 ? (
            <Empty text="暂无会话" />
          ) : (
            recentSessions.map((s) => (
              <Row
                key={s.session_id}
                onClick={() => navigate(`/sessions?session=${s.session_id}`)}
                title={s.project_name}
                sub={s.last_prompt || s.first_prompt || s.session_id}
                meta={s.provider}
              />
            ))
          )}
        </Panel>

        {/* 近期截止任务 */}
        <Panel title="近期截止" onMore={() => navigate("/board")}>
          {upcomingTasks.length === 0 ? (
            <Empty text="暂无临近截止的任务" />
          ) : (
            upcomingTasks.map((t) => (
              <Row
                key={t.id}
                onClick={() => navigate(workspaceRecordUrl("board", t.project))}
                title={t.title}
                meta={fmtDay(t.due_date)}
              />
            ))
          )}
        </Panel>

        {/* 近期事件 */}
        <Panel title="近期事件" onMore={() => navigate("/calendar")}>
          {upcomingEvents.length === 0 ? (
            <Empty text="暂无近期事件" />
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
        <Panel title="阅读队列" onMore={() => navigate("/reading")}>
          {readingQueue.length === 0 ? (
            <Empty text="阅读队列为空" />
          ) : (
            readingQueue.map((r) => (
              <Row
                key={r.id}
                onClick={() => navigate("/reading")}
                title={r.title}
                meta={r.status === "unread" ? "未读" : "在读"}
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
            查看全部
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
}: {
  title: string;
  sub?: string;
  meta?: string;
  dot?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-muted"
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
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-xs text-muted-foreground">{text}</p>;
}
