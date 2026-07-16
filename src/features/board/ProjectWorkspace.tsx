// ProjectWorkspace —— 打开一个项目后的「工作台」：
// 头部(返回 / 名称 / git 状态 / 项目设置) + 标签页(概览 / 会话 / 看板 / 文档 / AI)。
// 会话 tab 通过 repo_path == session.project_path 关联本地 CLI 会话（两级项目模型）。
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBoardStore } from "@/store/board";
import { useSessionsStore } from "@/store/sessions";
import { listEventsByProject } from "@/lib/pb/calendar";
import type { CalendarEvent } from "@/types/calendar";
import { KanbanBoard } from "./KanbanBoard";
import { ProjectSheet } from "./ProjectSheet";
import { GitStatusBar } from "./GitStatusBar";
import { WorkspaceSessions } from "./WorkspaceSessions";
import { DocsPanel } from "@/features/docs/DocsPanel";
import { AiChatPanel } from "@/features/ai/AiChatPanel";
import { STATE_CATEGORY_META } from "./board-meta";

export function ProjectWorkspace() {
  const openedProjectId = useBoardStore((s) => s.openedProjectId);
  const projects = useBoardStore((s) => s.projects);
  const closeProject = useBoardStore((s) => s.closeProject);
  const states = useBoardStore((s) => s.states);
  const tasks = useBoardStore((s) => s.tasks);
  const labels = useBoardStore((s) => s.labels);
  const sessions = useSessionsStore((s) => s.sessions);

  const [searchParams] = useSearchParams();
  // 深链接：?tab=<页> 决定初始标签页；?doc=<id> 定位文档标签内的具体文档
  const paramTab = searchParams.get("tab");
  const focusDocId = searchParams.get("doc") || undefined;
  const [tab, setTab] = useState(() => paramTab || "board");
  const [showSheet, setShowSheet] = useState(false);
  const [projectEvents, setProjectEvents] = useState<CalendarEvent[]>([]);
  const navigate = useNavigate();

  // 再次深链接（?tab 变化）时同步切换标签页
  useEffect(() => {
    if (paramTab) setTab(paramTab);
  }, [paramTab]);

  // 加载关联到本项目的日历事件（用于概览「近期事件」）
  useEffect(() => {
    if (!openedProjectId) return;
    let cancelled = false;
    void listEventsByProject(openedProjectId)
      .then((evs) => {
        if (!cancelled) setProjectEvents(evs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [openedProjectId]);

  const project = projects.find((p) => p.id === openedProjectId);
  if (!project) return null;
  const repoPath = project.repo_path;

  // 任务按状态类别统计（概览用）
  const catCounts = { pending: 0, active: 0, completed: 0 };
  for (const t of tasks) {
    const st = states.find((s) => s.id === t.state);
    if (st) catCounts[st.category] += 1;
  }
  const linkedCount = repoPath
    ? sessions.filter((s) => s.project_path === repoPath).length
    : 0;

  // 近期截止任务（有 due_date，按日期升序，取前 6）
  const upcomingTasks = [...tasks]
    .filter((t) => t.due_date)
    .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""))
    .slice(0, 6);

  // 近期事件（本项目关联，结束日 >= 今天，取前 6）
  const eventNow = new Date();
  eventNow.setHours(0, 0, 0, 0);
  const upcomingEvents = projectEvents
    .filter((e) => {
      try {
        return new Date(e.end || e.start) >= eventNow;
      } catch {
        return false;
      }
    })
    .slice(0, 6);

  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      {/* 头部 */}
      <div className="mb-4 flex shrink-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => closeProject()}
          aria-label="返回项目列表"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold">{project.name}</h1>
            {project.archived && <Badge variant="secondary">已归档</Badge>}
          </div>
          {repoPath && (
            <div className="mt-0.5">
              <GitStatusBar repoPath={repoPath} />
            </div>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowSheet(true)}>
          <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
          项目设置
        </Button>
      </div>

      {/* 标签页 */}
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="min-h-0 flex-1"
      >
        <TabsList className="shrink-0">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="sessions">会话</TabsTrigger>
          <TabsTrigger value="board">看板</TabsTrigger>
          <TabsTrigger value="docs">文档</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
        </TabsList>

        {/* 概览 */}
        <TabsContent value="overview" className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4">
            {/* 统计卡片 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="任务总数" value={tasks.length} />
              <StatCard
                label={STATE_CATEGORY_META.pending.label}
                value={catCounts.pending}
              />
              <StatCard
                label={STATE_CATEGORY_META.active.label}
                value={catCounts.active}
              />
              <StatCard
                label={STATE_CATEGORY_META.completed.label}
                value={catCounts.completed}
              />
            </div>

            {/* 元信息 */}
            <div className="rounded-xl border border-border bg-card p-4 text-sm">
              {project.description ? (
                <p className="text-foreground">{project.description}</p>
              ) : (
                <p className="text-muted-foreground">暂无项目描述。</p>
              )}
              <div className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground">
                <span>
                  仓库路径：
                  {repoPath ? (
                    <span className="font-mono text-foreground">{repoPath}</span>
                  ) : (
                    "未绑定（会话 / git 关联不可用）"
                  )}
                </span>
                <span>
                  {states.length} 个状态列 · {labels.length} 个标签 ·{" "}
                  {linkedCount} 个关联会话
                </span>
              </div>
            </div>

            {/* 近期截止任务（点击跳到看板） */}
            {upcomingTasks.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  近期截止
                </h3>
                <ul className="flex flex-col">
                  {upcomingTasks.map((t) => {
                    const st = states.find((s) => s.id === t.state);
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => setTab("board")}
                          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-muted"
                        >
                          {st && (
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: st.color }}
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate text-foreground">
                            {t.title}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {t.due_date
                              ? new Date(t.due_date).toLocaleDateString(
                                  "zh-CN",
                                  { month: "short", day: "numeric" },
                                )
                              : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* 近期事件（本项目关联的日历事件，点击去日历） */}
            {upcomingEvents.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  近期事件
                </h3>
                <ul className="flex flex-col">
                  {upcomingEvents.map((ev) => (
                    <li key={ev.id}>
                      <button
                        type="button"
                        onClick={() => navigate("/calendar")}
                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{
                            background: ev.color || "var(--color-primary)",
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {ev.title}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {ev.start
                            ? new Date(ev.start).toLocaleDateString("zh-CN", {
                                month: "short",
                                day: "numeric",
                              })
                            : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </TabsContent>

        {/* 会话 */}
        <TabsContent value="sessions" className="mt-3 flex min-h-0 flex-1 flex-col">
          {repoPath ? (
            <WorkspaceSessions repoPath={repoPath} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              该项目未绑定仓库路径 —— 在「项目设置」填写 repo_path 后即可关联本地会话。
            </div>
          )}
        </TabsContent>

        {/* 看板 */}
        <TabsContent value="board" className="mt-3 flex min-h-0 flex-1 flex-col">
          <KanbanBoard />
        </TabsContent>

        {/* 文档 */}
        <TabsContent value="docs" className="mt-3 flex min-h-0 flex-1 flex-col">
          <DocsPanel projectId={project.id} initialDocId={focusDocId} />
        </TabsContent>
        {/* AI 助手 */}
        <TabsContent value="ai" className="mt-3 flex min-h-0 flex-1 flex-col">
          <AiChatPanel
            projectId={project.id}
            projectName={project.name}
            repoPath={project.repo_path}
          />
        </TabsContent>
      </Tabs>

      {/* 项目设置抽屉 */}
      <ProjectSheet open={showSheet} onClose={() => setShowSheet(false)} />
    </div>
  );
}

// 概览统计小卡片
function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
