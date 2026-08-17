// BoardSurface —— 看板工作面：顶部 strip（看板/列表视图切换）+ 按视图分发渲染。
// 包住现有 KanbanBoard（不改其内部）；列表视图走 BoardListView。视图切换只切 board-view store，零重取数。
// 注：项目切换器不放这里（切项目属工作台容器层，放板 tab 工具条上心智不一致）；
// 待 B 期把看板抽成顶层独立页时，项目切换器移到该页头部（BoardProjectSwitcher 组件已备好复用）。
import { useTranslation } from "react-i18next";
import { useBoardViewStore, type BoardView } from "@/store/board-view";
import { KanbanBoard } from "./KanbanBoard";
import { BoardListView } from "./BoardListView";
import { cn } from "@/lib/utils";

export function BoardSurface() {
  const { t } = useTranslation("board");
  const view = useBoardViewStore((s) => s.view);
  const setView = useBoardViewStore((s) => s.setView);

  const VIEWS: { key: BoardView; label: string }[] = [
    { key: "kanban", label: t("view.kanban") },
    { key: "list", label: t("view.list") },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部 strip：视图分段控件（靠右） */}
      <div className="flex shrink-0 items-center gap-2 pb-2">
        <div className="ml-auto inline-flex rounded-lg border border-border p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={cn(
                "rounded-md px-2.5 py-0.5 text-xs transition-colors",
                view === v.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {/* 视图区（二选一；KanbanBoard 自带其搜索/筛选工具条） */}
      <div className="flex min-h-0 flex-1 flex-col">
        {view === "kanban" ? <KanbanBoard /> : <BoardListView />}
      </div>
    </div>
  );
}
