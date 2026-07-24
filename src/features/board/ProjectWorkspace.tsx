// ProjectWorkspace —— 打开一个项目后的「工作台」：
// 头部(返回 / 名称 / git 状态 / 项目设置) + 标签页(概览 / 会话 / 看板 / 文档 / AI)。
// 会话 tab 通过 repo_path == session.project_path 关联本地 CLI 会话（两级项目模型）。
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  FolderOpenIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useBoardStore } from "@/store/board";
import { useSessionsStore } from "@/store/sessions";
import { listEventsByProject } from "@/lib/pb/calendar";
import { listDocs } from "@/lib/pb/docs";
import type { CalendarEvent } from "@/types/calendar";
import { KanbanBoard } from "./KanbanBoard";
import { ProjectSheet } from "./ProjectSheet";
import { GitStatusBar } from "./GitStatusBar";
import { WorkspaceSessions } from "./WorkspaceSessions";
import { WorkspaceCommits } from "./WorkspaceCommits";
import { WorkspaceActivity } from "./WorkspaceActivity";
import { WorkspaceProcesses } from "./WorkspaceProcesses";
import { ImportPlanDialog } from "./ImportPlanDialog";
import { DocsPanel } from "@/features/docs/DocsPanel";
import { AiChatPanel } from "@/features/ai/AiChatPanel";
import { STATE_CATEGORY_META } from "./board-meta";
import { MemoryFilesBar } from "@/features/memory/MemoryFilesBar";
import { resolveInitialTab, rememberProjectTab } from "./project-tab-pref";

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
  // 初始标签页：深链 ?tab= > 该项目上次停留 > 全局默认（设置页可改），末尾兜底「看板」
  const [tab, setTab] = useState(() => resolveInitialTab(paramTab, openedProjectId));
  const [showSheet, setShowSheet] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [projectEvents, setProjectEvents] = useState<CalendarEvent[]>([]);
  const [docCount, setDocCount] = useState(0);
  const navigate = useNavigate();

  // 再次深链接（?tab 变化）时同步切换标签页
  useEffect(() => {
    if (paramTab) setTab(paramTab);
  }, [paramTab]);

  // 加载关联到本项目的日历事件（概览「近期事件」）+ 文档数（概览「项目信息」）
  useEffect(() => {
    if (!openedProjectId) return;
    let cancelled = false;
    void listEventsByProject(openedProjectId)
      .then((evs) => {
        if (!cancelled) setProjectEvents(evs);
      })
      .catch(() => {});
    void listDocs(openedProjectId)
      .then((ds) => {
        if (!cancelled) setDocCount(ds.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [openedProjectId]);

  const project = projects.find((p) => p.id === openedProjectId);
  const repoPath = project?.repo_path;

  // 概览统计只算「活跃任务」（排除已归档）——与看板默认隐藏归档保持一致，避免计数对不上。
  // 以下派生量全部 useMemo：tasks/sessions/events 任一变动才重算，避免每次 render 全跑一遍。
  const activeTasks = useMemo(() => tasks.filter((t) => !t.archived), [tasks]);

  // 任务按状态类别统计（概览用）
  const catCounts = useMemo(() => {
    const c = { pending: 0, active: 0, completed: 0 };
    for (const t of activeTasks) {
      const st = states.find((s) => s.id === t.state);
      if (st) c[st.category] += 1;
    }
    return c;
  }, [activeTasks, states]);

  const linkedCount = useMemo(
    () =>
      repoPath ? sessions.filter((s) => s.project_path === repoPath).length : 0,
    [repoPath, sessions],
  );

  // 近期截止任务（有 due_date，按日期升序，取前 6；归档任务已完成，不算"近期截止"）
  const upcomingTasks = useMemo(
    () =>
      [...activeTasks]
        .filter((t) => t.due_date)
        .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""))
        .slice(0, 6),
    [activeTasks],
  );

  // 近期事件（本项目关联，结束日 >= 今天，取前 6）
  const upcomingEvents = useMemo(() => {
    const eventNow = new Date();
    eventNow.setHours(0, 0, 0, 0);
    return projectEvents
      .filter((e) => {
        try {
          return new Date(e.end || e.start) >= eventNow;
        } catch {
          return false;
        }
      })
      .slice(0, 6);
  }, [projectEvents]);

  if (!project) return null;

  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      {/* 头部 */}
      <div className="mb-4 flex shrink-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            // 深链进入（URL 带 ?open，来自文档/总览/命令面板/会话跳转）→ 回到来源页；
            // 项目列表点开的（无 ?open）→ 关闭项目回列表。
            const deep = !!searchParams.get("open");
            closeProject();
            if (deep) navigate(-1);
          }}
          aria-label="返回"
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
        {repoPath && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void ipc
                .openPath(repoPath)
                .catch((e) => toast.error(`打开位置失败：${String(e)}`))
            }
          >
            <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
            打开位置
          </Button>
        )}
        {repoPath && (
          <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
            导入计划
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setShowSheet(true)}>
          <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
          项目设置
        </Button>
      </div>

      {/* 标签页 */}
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          // 记住该项目上次停留的标签页，下次打开自动回到这里
          if (openedProjectId) rememberProjectTab(openedProjectId, v);
        }}
        className="min-h-0 flex-1"
      >
        <TabsList className="shrink-0">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="sessions">会话</TabsTrigger>
          {/* 提交面仅在绑定了仓库路径时有意义 */}
          {repoPath && <TabsTrigger value="commits">提交</TabsTrigger>}
          <TabsTrigger value="board">看板</TabsTrigger>
          <TabsTrigger value="docs">文档</TabsTrigger>
          {/* 进程面仅在绑定仓库时有意义（按 repo_path 过滤 claude-runtime 进程） */}
          {repoPath && <TabsTrigger value="processes">进程</TabsTrigger>}
          <TabsTrigger value="activity">活动</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
        </TabsList>

        {/* 概览 */}
        <TabsContent value="overview" className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4">
            {/* 统计卡片 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="任务总数" value={activeTasks.length} />
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

            {/* 项目信息 */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">项目信息</h3>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    project.archived
                      ? "bg-muted text-muted-foreground"
                      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {project.archived ? "已归档" : "活跃"}
                </span>
              </div>

              {/* 描述 */}
              {project.description ? (
                <p className="mb-3 whitespace-pre-wrap text-sm text-foreground">
                  {project.description}
                </p>
              ) : (
                <p className="mb-3 text-sm text-muted-foreground">暂无项目描述。</p>
              )}

              {/* 关键信息键值网格 */}
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
                <InfoItem label="仓库路径" full>
                  {repoPath ? (
                    <span className="break-all font-mono text-foreground">{repoPath}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      未绑定（会话 / git 关联不可用）
                    </span>
                  )}
                </InfoItem>
                <InfoItem label="任务">{activeTasks.length} 个</InfoItem>
                <InfoItem label="文档">{docCount} 篇</InfoItem>
                <InfoItem label="关联会话">{linkedCount} 个</InfoItem>
                <InfoItem label="状态列 / 标签">
                  {states.length} / {labels.length}
                </InfoItem>
                <InfoItem label="创建于">{fmtDate(project.created)}</InfoItem>
                <InfoItem label="最近更新">{fmtDate(project.updated)}</InfoItem>
              </dl>
            </div>

            {/* 记忆注入项目文件（仅绑定仓库时） */}
            {repoPath && <MemoryFilesBar repoPath={repoPath} projectId={project.id} />}

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

        {/* 提交（commit → 催生它的会话；仅有仓库路径时） */}
        <TabsContent value="commits" className="mt-3 flex min-h-0 flex-1 flex-col">
          {repoPath ? (
            <WorkspaceCommits repoPath={repoPath} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              该项目未绑定仓库路径。
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
        {/* 进程（claude-runtime 托管：本项目跑的进程 + 日志 + start/stop/restart） */}
        {repoPath && (
          <TabsContent value="processes" className="mt-3 flex min-h-0 flex-1 flex-col">
            <WorkspaceProcesses repoPath={repoPath} />
          </TabsContent>
        )}
        {/* 活动（外部 AI 经 MCP 对本项目的操作：持久历史 + 实时流） */}
        <TabsContent value="activity" className="mt-3 flex min-h-0 flex-1 flex-col">
          <WorkspaceActivity projectId={project.id} />
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

      {/* 导入计划到看板 */}
      <ImportPlanDialog open={showImport} onClose={() => setShowImport(false)} project={project} />
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

// 「项目信息」键值项（full=true 时跨两列，用于长路径）
function InfoItem({
  label,
  children,
  full,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{children}</dd>
    </div>
  );
}

// 日期格式化：yyyy/MM/dd HH:mm（本地化），解析失败回退原串
function fmtDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
