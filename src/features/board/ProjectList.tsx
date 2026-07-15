import { useBoardStore } from "../../store/board";
import type { BoardProject } from "../../types/board";

// ── 单个项目卡片 ────────────────────────────────────────────────
interface ProjectCardProps {
  project: BoardProject;
}

function ProjectCard({ project }: ProjectCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      // Task 8: 点击打开看板（kanban 视图待实现）
      onClick={() => {
        // Task 8
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          // Task 8
        }
      }}
      className={[
        "flex cursor-pointer flex-col gap-1 rounded-lg border border-border",
        "bg-card p-4 shadow-sm transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        "focus:outline-none focus:ring-2 focus:ring-ring",
      ].join(" ")}
    >
      {/* 项目名称 + 归档徽章 */}
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-sm font-medium text-foreground">
          {project.name}
        </span>
        {project.archived && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            已归档
          </span>
        )}
      </div>

      {/* 仓库路径（小字，仅在有值时显示） */}
      {project.repo_path && (
        <span className="truncate text-xs text-muted-foreground">
          {project.repo_path}
        </span>
      )}
    </div>
  );
}

// ── 项目列表组件 ────────────────────────────────────────────────
/**
 * 从 useBoardStore 读取 projects / loading / error，
 * 渲染卡片网格或对应的空/加载/错误状态。
 */
export function ProjectList() {
  const projects = useBoardStore((s) => s.projects);
  const loading = useBoardStore((s) => s.loading);
  const error = useBoardStore((s) => s.error);

  // 加载中状态
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }

  // 错误状态
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

  // 空状态
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
        <span>暂无项目</span>
        <span className="text-xs">点击"新建项目"创建第一个看板</span>
      </div>
    );
  }

  // 项目卡片网格
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}
