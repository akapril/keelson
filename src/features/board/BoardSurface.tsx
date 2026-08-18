// BoardSurface —— 看板工作面：顶部 strip（看板/列表视图切换 + 泳道 + 保存视图）+ 按视图分发渲染。
// 包住现有 KanbanBoard（不改其内部）；列表视图走 BoardListView。视图切换只切 board-view store，零重取数。
// 注：项目切换器不放这里（切项目属工作台容器层，放板 tab 工具条上心智不一致）；
// 待 B 期把看板抽成顶层独立页时，项目切换器移到该页头部（BoardProjectSwitcher 组件已备好复用）。
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useBoardViewStore, type BoardView, type SwimlaneKey } from "@/store/board-view";
import { useSavedViewsStore } from "@/store/board-views";
import { useBoardStore } from "@/store/board";
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
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export function BoardSurface() {
  const { t } = useTranslation("board");

  // 当前视图配置（三值）
  const viewType = useBoardViewStore((s) => s.viewType);
  const setViewType = useBoardViewStore((s) => s.setViewType);
  const swimlane = useBoardViewStore((s) => s.swimlane);
  const setSwimlane = useBoardViewStore((s) => s.setSwimlane);
  const filter = useBoardViewStore((s) => s.filter);
  const applyConfig = useBoardViewStore((s) => s.applyConfig);

  // 当前打开的项目 id
  const openedProjectId = useBoardStore((s) => s.openedProjectId);

  // 保存视图 store
  const views = useSavedViewsStore((s) => s.views);
  const loadViews = useSavedViewsStore((s) => s.load);
  const createView = useSavedViewsStore((s) => s.create);
  const renameView = useSavedViewsStore((s) => s.rename);
  const removeView = useSavedViewsStore((s) => s.remove);

  // 挂载/项目切换时加载该项目的保存视图
  useEffect(() => {
    if (!openedProjectId) return;
    loadViews(openedProjectId).catch((e) =>
      toast.error(t("savedView.error", { msg: String(e) })),
    );
  }, [openedProjectId, loadViews, t]);

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

  /** 保存当前视图为新视图 */
  function handleSaveCurrent() {
    if (!openedProjectId) return;
    // 使用浏览器原生 prompt 获取视图名称
    const name = window.prompt(t("savedView.namePlaceholder"));
    if (!name || !name.trim()) return;
    createView({
      project: openedProjectId,
      name: name.trim(),
      view_type: viewType,
      filter,
      swimlane,
      sort_order: views.length,
    }).catch((e) => toast.error(t("savedView.error", { msg: String(e) })));
  }

  /** 重命名保存视图 */
  function handleRenameView(id: string, currentName: string) {
    const name = window.prompt(t("savedView.namePlaceholder"), currentName);
    if (!name || !name.trim() || name.trim() === currentName) return;
    renameView(id, name.trim()).catch((e) =>
      toast.error(t("savedView.error", { msg: String(e) })),
    );
  }

  /** 删除保存视图（confirm 确认） */
  function handleDeleteView(id: string) {
    if (!window.confirm(t("savedView.confirmDelete"))) return;
    removeView(id).catch((e) =>
      toast.error(t("savedView.error", { msg: String(e) })),
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部 strip：泳道下拉（仅看板视图）+ 保存视图下拉 + 视图分段控件（靠右） */}
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

        {/* 保存视图下拉：列出/应用/存/改名/删 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs transition-colors",
                "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {t("savedView.menu")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {/* 保存当前为新视图 */}
            <DropdownMenuItem
              onClick={handleSaveCurrent}
              disabled={!openedProjectId}
            >
              {t("savedView.saveCurrent")}
            </DropdownMenuItem>

            {/* 已保存视图列表 */}
            {views.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {t("savedView.menu")}
                </DropdownMenuLabel>
                {views.map((v) => (
                  <div key={v.id} className="group flex items-center">
                    {/* 点击名称部分 → 应用视图 */}
                    <DropdownMenuItem
                      className="flex-1"
                      onClick={() =>
                        applyConfig({
                          viewType: v.view_type,
                          filter: v.filter,
                          swimlane: v.swimlane,
                        })
                      }
                    >
                      <span className="flex-1 truncate">{v.name}</span>
                    </DropdownMenuItem>
                    {/* 改名按钮 */}
                    <button
                      type="button"
                      className="mr-1 hidden rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground group-hover:inline-flex"
                      onClick={(e) => {
                        // 阻止 DropdownMenu 关闭
                        e.stopPropagation();
                        handleRenameView(v.id, v.name);
                      }}
                      title={t("savedView.rename")}
                    >
                      {t("savedView.rename")}
                    </button>
                    {/* 删除按钮 */}
                    <button
                      type="button"
                      className="mr-1 hidden rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:inline-flex"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteView(v.id);
                      }}
                      title={t("savedView.delete")}
                    >
                      {t("savedView.delete")}
                    </button>
                  </div>
                ))}
              </>
            )}

            {/* 空态提示（无保存视图时） */}
            {views.length === 0 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {t("savedView.empty")}
                </div>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 视图类型分段控件（靠右） */}
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
