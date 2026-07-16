import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { useBoardStore } from "@/store/board";
import { requestedRecordId } from "@/lib/workspace-navigation";
import { ProjectList } from "@/features/board/ProjectList";
import { CreateProjectDialog } from "@/features/board/CreateProjectDialog";
import { ProjectWorkspace } from "@/features/board/ProjectWorkspace";

/**
 * 项目页 = 项目工作台入口。
 * - 未打开项目：项目列表（“项目主页”）+ 新建项目。
 * - 已打开项目：ProjectWorkspace（概览/会话/看板/文档/AI 标签页）。
 * 支持 ?open=<projectId> 深链接（来自会话中枢「提升为看板项目」/ 卡片跳转）。
 */
export default function Board() {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const openedProjectId = useBoardStore((s) => s.openedProjectId);
  const projects = useBoardStore((s) => s.projects);

  const [searchParams] = useSearchParams();
  const requestedId = requestedRecordId(searchParams);

  // 挂载时并行加载模板和项目列表
  useEffect(() => {
    useBoardStore.getState().loadTemplates();
    useBoardStore.getState().loadProjects();
  }, []);

  // 深链接：?open=<projectId> 且该项目已在列表中 → 自动打开工作台
  useEffect(() => {
    if (!requestedId) return;
    if (openedProjectId === requestedId) return;
    if (projects.some((p) => p.id === requestedId)) {
      void useBoardStore.getState().openProject(requestedId);
    }
  }, [requestedId, projects, openedProjectId]);

  // 已打开项目 → 工作台
  if (openedProjectId) {
    return <ProjectWorkspace />;
  }

  // 未打开 → 项目列表主页
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      <div className="mb-6 flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">项目</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            每个项目 = 它的会话、看板、文档与 git，集中在一处工作台。
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          新建项目
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ProjectList />
      </div>

      {showCreateDialog && (
        <CreateProjectDialog onClose={() => setShowCreateDialog(false)} />
      )}
    </div>
  );
}
