import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useBoardStore } from "../../store/board";
import { useSessionsStore } from "../../store/sessions";
import { listAllTasks, listAllStates } from "../../lib/pb/board";
import { listAllDocs } from "../../lib/pb/docs";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { BoardProject } from "../../types/board";

/** 复制文本到剪贴板 + 反馈 */
export function copyText(text: string, label: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`已复制${label}`),
    () => toast.error("复制失败"),
  );
}

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
  hint,
}: {
  project: BoardProject;
  stat?: ProjectStat;
  /** 是否与其他项目同名（需展示消歧信息） */
  duplicate: boolean;
  /** 无描述时的兜底提示：扫描到的最近会话提示词（「在做什么」） */
  hint?: string;
}) {
  const openProject = useBoardStore((s) => s.openProject);
  const updateProject = useBoardStore((s) => s.updateProject);
  const handleOpen = () => void openProject(project.id);

  const total = stat?.total ?? 0;
  const done = stat?.done ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const card = (
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

      {/* 「这个项目是做什么的」：优先项目描述；无则用扫描到的最近会话提示词兜底 */}
      {project.description ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {project.description}
        </p>
      ) : hint ? (
        <p className="line-clamp-2 text-xs italic leading-relaxed text-muted-foreground/80">
          最近：{hint}
        </p>
      ) : (
        <p className="text-xs italic text-muted-foreground/50">暂无描述</p>
      )}

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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={handleOpen}>打开项目</ContextMenuItem>
        {project.repo_path && (
          <ContextMenuItem onSelect={() => copyText(project.repo_path!, "仓库路径")}>
            复制仓库路径
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() =>
            void updateProject(project.id, { archived: !project.archived }).catch(
              (e) => toast.error(`操作失败：${String(e)}`),
            )
          }
        >
          {project.archived ? "取消归档" : "归档"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── 项目列表组件 ────────────────────────────────────────────────
export function ProjectList({ showArchived = false }: { showArchived?: boolean }) {
  const allProjects = useBoardStore((s) => s.projects);
  const loading = useBoardStore((s) => s.loading);
  const error = useBoardStore((s) => s.error);
  const sessions = useSessionsStore((s) => s.sessions);

  // 默认隐藏已归档项目（板面清爽）；「显示归档」开关打开时才展示
  const projects = showArchived ? allProjects : allProjects.filter((p) => !p.archived);

  const [stats, setStats] = useState<Record<string, ProjectStat>>({});

  // 拉全部任务/状态/文档，聚合每个项目的统计（非阻塞卡片渲染）。
  // 触发时机：挂载、项目增删（projects.length 变化）、以及窗口重新聚焦——
  // 覆盖「在别处/别的窗口改了任务或文档（Spotlight 建任务 / ⌘K / 后台同步）后
  // 回到已挂载的首页，卡片统计不刷新」的陈旧问题（sessionCount 走 store 实时，
  // 只有 task/doc 计数需要在此主动重拉）。
  useEffect(() => {
    let cancelled = false;
    const loadStats = async () => {
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
          // 归档任务不计入项目卡片统计（与看板默认隐藏归档一致）
          if (t.archived) continue;
          const st = ensure(t.project);
          st.total += 1;
          if (doneState.has(t.state)) st.done += 1;
        }
        // 多对多：文档计入其每个关联项目
        for (const d of docs) for (const pid of d.projects ?? []) ensure(pid).docs += 1;
        setStats(map);
      } catch {
        /* 统计失败不影响卡片基本展示 */
      }
    };
    void loadStats();
    // 窗口重新聚焦时重拉，保持首页统计新鲜（返回应用/切回主窗时触发）
    const onFocus = () => void loadStats();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [projects.length]);

  // 会话数按 repo_path 匹配（来自会话中枢缓存）
  const sessionCount = (repoPath?: string) =>
    repoPath ? sessions.filter((s) => s.project_path === repoPath).length : 0;

  // 最近会话提示词（扫描到的「在做什么」，无项目描述时兜底展示）
  const latestPrompt = (repoPath?: string): string => {
    if (!repoPath) return "";
    const list = sessions.filter((s) => s.project_path === repoPath);
    if (list.length === 0) return "";
    const latest = list.reduce((a, b) => (a.updated_at > b.updated_at ? a : b));
    return (latest.last_prompt || latest.first_prompt || "").trim();
  };

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
    // 区分「真无项目」与「都被归档隐藏了」
    const allArchived = allProjects.length > 0;
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
        <span>{allArchived ? "当前无进行中的项目" : "暂无项目"}</span>
        <span className="text-xs">
          {allArchived
            ? "已有项目均已归档，点右上「显示归档」查看"
            : "点击“新建项目”创建第一个看板"}
        </span>
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
            hint={latestPrompt(project.repo_path)}
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
