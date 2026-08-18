// 看板当前视图配置（视图类型/筛选/泳道）——单一真源，供 BoardSurface/KanbanBoard/List/Timeline 共读。
// viewType 本机持久化（项目无关）；filter/swimlane 是临时工作态（切项目重置，因引用项目级 label/state）。
import { create } from "zustand";
import { EMPTY_FILTER, type TaskFilter } from "@/features/board/task-filter";

export type BoardView = "kanban" | "list" | "timeline";
export type SwimlaneKey = "none" | "priority" | "assignee" | "label" | "agent";

/** 保存视图捕获的整套配置（PB board_views 存/取即此形状）。 */
export interface SavedViewConfig {
  viewType: BoardView;
  filter: TaskFilter;
  swimlane: SwimlaneKey;
}

/** viewType 持久化 key（仅存视图类型；filter/swimlane 不持久化）。 */
const STORAGE_KEY = "keelson:board-view";

/** 从 localStorage 读初始视图类型，非法/缺失回退 kanban。 */
function initialViewType(): BoardView {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "list" || v === "timeline" ? v : "kanban";
  } catch {
    return "kanban";
  }
}

interface BoardViewState {
  viewType: BoardView;
  filter: TaskFilter;
  swimlane: SwimlaneKey;
  setViewType: (v: BoardView) => void;
  setFilter: (f: TaskFilter) => void;
  setSwimlane: (s: SwimlaneKey) => void;
  /** 应用保存视图：整套配置灌入。 */
  applyConfig: (cfg: SavedViewConfig) => void;
  /** 切项目：清空 filter/swimlane（引用项目级数据），保留 viewType。 */
  resetForProject: () => void;
}

export const useBoardViewStore = create<BoardViewState>((set) => {
  const _initial = initialViewType();
  return {
    viewType: _initial,
    filter: EMPTY_FILTER,
    swimlane: "none",

    setViewType: (viewType) => {
      try {
        localStorage.setItem(STORAGE_KEY, viewType);
      } catch {
        /* 隐私模式写入失败忽略 */
      }
      set({ viewType });
    },

    setFilter: (filter) => set({ filter }),

    setSwimlane: (swimlane) => set({ swimlane }),

    applyConfig: (cfg) => {
      try {
        localStorage.setItem(STORAGE_KEY, cfg.viewType);
      } catch {
        /* 忽略 */
      }
      set({ viewType: cfg.viewType, filter: cfg.filter, swimlane: cfg.swimlane });
    },

    resetForProject: () => set({ filter: EMPTY_FILTER, swimlane: "none" }),
  };
});
