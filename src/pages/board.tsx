import { useEffect, useState } from "react";
import { useBoardStore } from "../store/board";
import { ProjectList } from "../features/board/ProjectList";
import { CreateProjectDialog } from "../features/board/CreateProjectDialog";

/**
 * 看板首页。
 * 挂载时并行加载模板和项目列表（互不依赖）。
 * 左侧：项目卡片列表；右侧（Task 8）：打开的项目看板。
 * 新建项目对话框由 Task 7 实现，此处仅预留按钮占位。
 */
export default function Board() {
  // 控制"新建项目"对话框是否显示
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // 挂载时并行加载模板和项目列表
  useEffect(() => {
    useBoardStore.getState().loadTemplates();
    useBoardStore.getState().loadProjects();
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      {/* 页头：标题 + 新建按钮 */}
      <div className="mb-6 flex shrink-0 items-center justify-between">
        <h1 className="text-base font-semibold">看板</h1>
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
      </div>

      {/* 项目卡片列表（可滚动区域） */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ProjectList />
      </div>

      {/* 新建项目对话框（按需挂载） */}
      {showCreateDialog && (
        <CreateProjectDialog onClose={() => setShowCreateDialog(false)} />
      )}
    </div>
  );
}
