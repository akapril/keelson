import { useEffect, useState } from "react";
import { useBoardStore } from "../store/board";
import { ProjectList } from "../features/board/ProjectList";
import { CreateProjectDialog } from "../features/board/CreateProjectDialog";
import { KanbanBoard } from "../features/board/KanbanBoard";
import { ProjectSheet } from "../features/board/ProjectSheet";

/**
 * 看板首页。
 * 挂载时并行加载模板和项目列表（互不依赖）。
 * - openedProjectId 为 null：显示项目卡片列表
 * - openedProjectId 非 null：显示已打开项目的 KanbanBoard
 */
export default function Board() {
  // 控制"新建项目"对话框是否显示
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  // 控制"项目设置"抽屉是否显示
  const [showProjectSheet, setShowProjectSheet] = useState(false);
  const openedProjectId = useBoardStore((s) => s.openedProjectId);
  const projects = useBoardStore((s) => s.projects);

  // 挂载时并行加载模板和项目列表
  useEffect(() => {
    useBoardStore.getState().loadTemplates();
    useBoardStore.getState().loadProjects();
  }, []);

  // 当前已打开项目的名称（用于面包屑）
  const openedProject = projects.find((p) => p.id === openedProjectId);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      {/* 页头：标题（看板 / 项目名）+ 操作按钮 */}
      <div className="mb-6 flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2">
          {/* 有已打开项目时显示返回链接 */}
          {openedProjectId && (
            <button
              type="button"
              onClick={() => useBoardStore.getState().closeProject()}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              看板
            </button>
          )}
          {openedProjectId && (
            <span className="text-sm text-muted-foreground">/</span>
          )}
          <h1 className="text-base font-semibold">
            {openedProject ? openedProject.name : "看板"}
          </h1>
        </div>

        {/* 新建项目按钮（只在列表视图显示） */}
        {!openedProjectId && (
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            className={[
              "rounded-md bg-primary px-4 py-1.5 text-sm font-medium",
              "text-primary-foreground shadow-sm transition-colors",
              "hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring",
            ].join(" ")}
          >
            新建项目
          </button>
        )}

        {/* 项目设置按钮（只在已打开项目时显示） */}
        {openedProjectId && (
          <button
            type="button"
            onClick={() => setShowProjectSheet(true)}
            className={[
              "rounded-md border border-border px-4 py-1.5 text-sm font-medium",
              "text-foreground transition-colors",
              "hover:bg-accent hover:text-accent-foreground",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            ].join(" ")}
          >
            项目设置
          </button>
        )}
      </div>

      {/* 主内容区：项目列表 或 看板 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {openedProjectId ? (
          // Task 8: 已打开项目 → 显示看板视图
          <KanbanBoard />
        ) : (
          // 默认：显示项目卡片列表
          <ProjectList />
        )}
      </div>

      {/* 新建项目对话框（按需挂载） */}
      {showCreateDialog && (
        <CreateProjectDialog onClose={() => setShowCreateDialog(false)} />
      )}

      {/* 项目设置抽屉（受控，作用于当前打开的项目） */}
      <ProjectSheet
        open={showProjectSheet}
        onClose={() => setShowProjectSheet(false)}
      />
    </div>
  );
}
