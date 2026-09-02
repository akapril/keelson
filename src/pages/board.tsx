import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("board");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  // 是否显示已归档项目（默认隐藏，让列表清爽；删除归档项目时切开来找）
  const [showArchived, setShowArchived] = useState(false);
  const openedProjectId = useBoardStore((s) => s.openedProjectId);
  const projects = useBoardStore((s) => s.projects);
  const archivedCount = projects.filter((p) => p.archived).length;

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
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-3 sm:p-6">
      <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2 sm:mb-6">
        <div>
          <h1 className="text-lg font-semibold">{t("page.title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("page.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 显示/隐藏归档项目（有归档才出现） */}
          {archivedCount > 0 && (
            <Button
              variant="outline"
              onClick={() => setShowArchived((v) => !v)}
              aria-pressed={showArchived}
              className={showArchived ? "text-primary" : "text-muted-foreground"}
            >
              {showArchived ? t("page.hideArchived") : t("page.showArchived", { count: archivedCount })}
            </Button>
          )}
          <Button onClick={() => setShowCreateDialog(true)}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            {t("createProject.title")}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ProjectList showArchived={showArchived} />
      </div>

      {showCreateDialog && (
        <CreateProjectDialog onClose={() => setShowCreateDialog(false)} />
      )}
    </div>
  );
}
