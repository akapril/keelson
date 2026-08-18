// BoardSurface —— 看板工作面：顶部 strip（看板/列表视图切换）+ 按视图分发渲染。
// 包住现有 KanbanBoard（不改其内部）；列表视图走 BoardListView。视图切换只切 board-view store，零重取数。
// 注：项目切换器不放这里（切项目属工作台容器层，放板 tab 工具条上心智不一致）；
// 待 B 期把看板抽成顶层独立页时，项目切换器移到该页头部（BoardProjectSwitcher 组件已备好复用）。
import { useTranslation } from "react-i18next";
import { useBoardViewStore, type BoardView, type SwimlaneKey } from "@/store/board-view";
import { KanbanBoard } from "./KanbanBoard";
import { BoardListView } from "./BoardListView";
import { TimelineView } from "./TimelineView";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

export function BoardSurface() {
  const { t } = useTranslation("board");
  const viewType = useBoardViewStore((s) => s.viewType);
  const setViewType = useBoardViewStore((s) => s.setViewType);
  const swimlane = useBoardViewStore((s) => s.swimlane);
  const setSwimlane = useBoardViewStore((s) => s.setSwimlane);

  const VIEWS: { key: BoardView; label: string }[] = [
    { key: "kanban", label: t("view.kanban") },
    { key: "list", label: t("view.list") },
    { key: "timeline", label: t("view.timeline") },
  ];

  // 泳道选项：无/优先级/负责人/标签/agent
  const SWIMLANE_OPTIONS: { key: SwimlaneKey; label: string }[] = [
    { key: "none", label: t("swimlane.none") },
    { key: "priority", label: t("swimlane.priority") },
    { key: "assignee", label: t("swimlane.assignee") },
    { key: "label", label: t("swimlane.byLabel") },
    { key: "agent", label: t("swimlane.agent") },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部 strip：视图分段控件（靠右） + 泳道下拉（仅看板视图） */}
      <div className="flex shrink-0 items-center gap-2 pb-2">
        {/* 看板模式下：泳道二级分组下拉 */}
        {viewType === "kanban" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs transition-colors",
                  swimlane !== "none"
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                {t("swimlane.label")}
                {swimlane !== "none" && (
                  <span className="font-medium">
                    ：{SWIMLANE_OPTIONS.find((o) => o.key === swimlane)?.label}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuLabel>{t("swimlane.label")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={swimlane}
                onValueChange={(v) => setSwimlane(v as SwimlaneKey)}
              >
                {SWIMLANE_OPTIONS.map((opt) => (
                  <DropdownMenuRadioItem key={opt.key} value={opt.key}>
                    {opt.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <div className="ml-auto inline-flex rounded-lg border border-border p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setViewType(v.key)}
              className={cn(
                "rounded-md px-2.5 py-0.5 text-xs transition-colors",
                viewType === v.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {/* 视图区（三态分发；KanbanBoard 自带其搜索/筛选工具条） */}
      <div className="flex min-h-0 flex-1 flex-col">
        {viewType === "kanban" ? <KanbanBoard /> : viewType === "list" ? <BoardListView /> : <TimelineView />}
      </div>
    </div>
  );
}
