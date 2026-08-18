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
  /** @deprecated Task 2 删除——保持 BoardSurface 当前不改也可编译。 */
  view: BoardView;
  /** @deprecated Task 2 删除——保持 BoardSurface 当前不改也可编译。 */
  setView: (v: BoardView) => void;
}

export const useBoardViewStore = create<BoardViewState>((set, get) => {
  const _initial = initialViewType();
  return {
    viewType: _initial,
    filter: EMPTY_FILTER,
    swimlane: "none",
    // —— 向后兼容冗余字段（与 viewType 同步；Task 2 消费方迁完后删除）——
    view: _initial,

    setViewType: (viewType) => {
      try {
        localStorage.setItem(STORAGE_KEY, viewType);
      } catch {
        /* 隐私模式写入失败忽略 */
      }
      // 同步更新 view 别名，保持 BoardSurface 读到的值一致
      set({ viewType, view: viewType });
    },

    setFilter: (filter) => set({ filter }),

    setSwimlane: (swimlane) => set({ swimlane }),

    applyConfig: (cfg) => {
      try {
        localStorage.setItem(STORAGE_KEY, cfg.viewType);
      } catch {
        /* 忽略 */
      }
      // 同步更新 view 别名
      set({ viewType: cfg.viewType, view: cfg.viewType, filter: cfg.filter, swimlane: cfg.swimlane });
    },

    resetForProject: () => set({ filter: EMPTY_FILTER, swimlane: "none" }),

    /** @deprecated 委托给 setViewType */
    setView: (v: BoardView) => get().setViewType(v),
  };
});
