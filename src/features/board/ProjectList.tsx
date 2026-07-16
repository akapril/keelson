import { useEffect, useState } from "react";
import { useBoardStore } from "../../store/board";
import { useSessionsStore } from "../../store/sessions";
import { listAllTasks, listAllStates } from "../../lib/pb/board";
import { listAllDocs } from "../../lib/pb/docs";
import type { BoardProject } from "../../types/board";

// 单项目统计（用于卡片展示）
interface ProjectStat {
  total: number;
  done: number;
  docs: number;
  sessions: number;
}

// 仓库路径末段（用于同名项目消歧）
function repoTail(path?: string): string {
  if (!path) return "";
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return "";
  }
}

// ── 单个项目卡片 ────────────────────────────────────────────────
function ProjectCard({
  project,
  stat,
  duplicate,
}: {
  project: BoardProject;
  stat?: ProjectStat;
  /** 是否与其他项目同名（需展示消歧信息） */
  duplicate: boolean;
}) {
  const openProject = useBoardStore((s) => s.openProject);
  const handleOpen = () => void openProject(project.id);

  const total = stat?.total ?? 0;
  const done = stat?.done ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleOpen();
      }}
      className="flex cursor-pointer flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-border hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {/* 名称 + 归档 */}
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-sm font-medium text-foreground" title={project.name}>
          {project.name}
        </span>
        {project.archived && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            已归档
          </span>
        )}
      </div>

      {/* 消歧信息：仓库路径 + 创建日期（同名项目务必显示以区分） */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {project.repo_path ? (
          <span className="truncate font-mono" title={project.repo_path}>
            {duplicate ? project.repo_path : repoTail(project.repo_path)}
          </span>
        ) : (
          <span className="italic">未绑定仓库</span>
        )}
        <span className="ml-auto shrink-0">{fmtDate(project.created)}</span>
      </div>

      {/* 进度条（完成/总任务） */}
      <div className="mt-0.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* 计数：任务 done/total · 文档 · 会话 */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
        <span>
          任务 {done}/{total}
        </span>
        <span>文档 {stat?.docs ?? 0}</span>
        <span>会话 {stat?.sessions ?? 0}</span>
      </div>
    </div>
  );
}

// ── 项目列表组件 ────────────────────────────────────────────────
export function ProjectList() {
  const projects = useBoardStore((s) => s.projects);
  const loading = useBoardStore((s) => s.loading);
  const error = useBoardStore((s) => s.error);
  const sessions = useSessionsStore((s) => s.sessions);

  const [stats, setStats] = useState<Record<string, ProjectStat>>({});

  // 拉全部任务/状态/文档，聚合每个项目的统计（一次性，非阻塞卡片渲染）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [tasks, states, docs] = await Promise.all([
          listAllTasks(),
          listAllStates(),
          listAllDocs(),
        ]);
        if (cancelled) return;
        // state_id → 是否「完成」类别
        const doneState = new Set(
          states.filter((s) => s.category === "completed").map((s) => s.id),
        );
        const map: Record<string, ProjectStat> = {};
        const ensure = (pid: string) =>
          (map[pid] ??= { total: 0, done: 0, docs: 0, sessions: 0 });
        for (const t of tasks) {
          const st = ensure(t.project);
          st.total += 1;
          if (doneState.has(t.state)) st.done += 1;
        }
        for (const d of docs) ensure(d.project).docs += 1;
        setStats(map);
      } catch {
        /* 统计失败不影响卡片基本展示 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projects.length]);

  // 会话数按 repo_path 匹配（来自会话中枢缓存）
  const sessionCount = (repoPath?: string) =>
    repoPath ? sessions.filter((s) => s.project_path === repoPath).length : 0;

  // 同名检测（用于消歧显示）
  const nameCounts = projects.reduce<Record<string, number>>((acc, p) => {
    acc[p.name] = (acc[p.name] ?? 0) + 1;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        {error}
      </div>
    );
  }
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
        <span>暂无项目</span>
        <span className="text-xs">点击“新建项目”创建第一个看板</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => {
        const stat = stats[project.id];
        return (
          <ProjectCard
            key={project.id}
            project={project}
            duplicate={(nameCounts[project.name] ?? 0) > 1}
            stat={{
              total: stat?.total ?? 0,
              done: stat?.done ?? 0,
              docs: stat?.docs ?? 0,
              sessions: sessionCount(project.repo_path),
            }}
          />
        );
      })}
    </div>
  );
}
