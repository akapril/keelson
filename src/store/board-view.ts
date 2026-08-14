// 看板视图状态（看板/列表）——本机持久化，切换零重取数（只切视图，不动 board store）。
import { create } from "zustand";

export type BoardView = "kanban" | "list";

/** 持久化 key（改此一处）。 */
const STORAGE_KEY = "keelson:board-view";

/** 从 localStorage 读初始视图，非法/缺失回退 kanban。 */
function initialView(): BoardView {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "list" ? "list" : "kanban";
  } catch {
    return "kanban";
  }
}

interface BoardViewState {
  view: BoardView;
  setView: (v: BoardView) => void;
}

export const useBoardViewStore = create<BoardViewState>((set) => ({
  view: initialView(),
  setView: (view) => {
    try {
      localStorage.setItem(STORAGE_KEY, view);
    } catch {
      /* 隐私模式写入失败忽略 */
    }
    set({ view });
  },
}));
