// ProjectWorkspace —— 打开一个项目后的「工作台」：
// 头部(返回 / 名称 / git 状态 / 项目设置) + 标签页(概览 / 会话 / 看板 / 文档 / AI)。
// 会话 tab 通过 repo_path == session.project_path 关联本地 CLI 会话（两级项目模型）。
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Settings02Icon,
  DocumentAttachmentIcon,
  AiChat02Icon,
} from "@hugeicons/core-free-icons";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBoardStore } from "@/store/board";
import { useSessionsStore } from "@/store/sessions";
import { KanbanBoard } from "./KanbanBoard";
import { ProjectSheet } from "./ProjectSheet";
import { GitStatusBar } from "./GitStatusBar";
import { WorkspaceSessions } from "./WorkspaceSessions";
import { STATE_CATEGORY_META } from "./board-meta";

// 空标签页占位（文档 / AI，Phase③④ 实现）
function ComingSoon({ icon, title }: { icon: typeof AiChat02Icon; title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <HugeiconsIcon icon={icon} strokeWidth={1.5} className="size-10 opacity-60" />
      <p className="text-sm">
        {title} · <span className="opacity-70">即将推出</span>
      </p>
    </div>
  );
}

export function ProjectWorkspace() {
  const openedProjectId = useBoardStore((s) => s.openedProjectId);
  const projects = useBoardStore((s) => s.projects);
  const closeProject = useBoardStore((s) => s.closeProject);
  const states = useBoardStore((s) => s.states);
  const tasks = useBoardStore((s) => s.tasks);
  const labels = useBoardStore((s) => s.labels);
  const sessions = useSessionsStore((s) => s.sessions);

  const [tab, setTab] = useState("board");
  const [showSheet, setShowSheet] = useState(false);

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

        {/* 文档 / AI 占位 */}
        <TabsContent value="docs" className="mt-3 min-h-0 flex-1">
          <ComingSoon icon={DocumentAttachmentIcon} title="项目文档" />
        </TabsContent>
        <TabsContent value="ai" className="mt-3 min-h-0 flex-1">
          <ComingSoon icon={AiChat02Icon} title="项目 AI 助手" />
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
