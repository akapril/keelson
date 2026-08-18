// 保存视图 Store：CRUD + 乐观更新（写失败回滚并重抛，供调用点 toast）。
// 范式与 store/agents.ts 保持一致：store 不 toast，错误由调用方处理。
import { create } from "zustand";
import {
  listSavedViews,
  createSavedView,
  updateSavedView,
  softDeleteSavedView,
} from "../lib/pb/board-views";
import type { SavedBoardView } from "../types/board-view-saved";
import type { BoardView, SwimlaneKey } from "./board-view";
import type { TaskFilter } from "../features/board/task-filter";

/** create() 所需的输入字段（owner/id/时间戳由 pb 层填充）。 */
export interface CreateSavedViewInput {
  project: string;
  name: string;
  view_type: BoardView;
  filter: TaskFilter;
  swimlane: SwimlaneKey;
  sort_order: number;
}

interface SavedViewsState {
  views: SavedBoardView[];
  loading: boolean;
  /** 加载指定项目的保存视图（覆盖当前列表）。 */
  load: (projectId: string) => Promise<void>;
  /** 创建新保存视图，乐观追加（追加到末尾；pb 返回完整记录后替换占位）。 */
  create: (input: CreateSavedViewInput) => Promise<SavedBoardView>;
  /** 重命名视图：乐观更新；失败回滚并重抛。 */
  rename: (id: string, name: string) => Promise<void>;
  /** 软删除视图：乐观移除；失败回滚并重抛。 */
  remove: (id: string) => Promise<void>;
}

export const useSavedViewsStore = create<SavedViewsState>((set, get) => ({
  views: [],
  loading: false,

  load: async (projectId) => {
    set({ loading: true });
    try {
      const views = await listSavedViews(projectId);
      set({ views, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e; // 加载失败同样重抛，调用点可 toast
    }
  },

  create: async (input) => {
    // 不做乐观插入（缺乏 id/时间戳），直接调 pb，成功后追加到列表末尾
    const rec = await createSavedView(input);
    set({ views: [...get().views, rec] });
    return rec;
  },

  rename: async (id, name) => {
    const { views } = get();
    // 乐观更新本地名称
    set({ views: views.map((v) => (v.id === id ? { ...v, name } : v)) });
    try {
      await updateSavedView(id, { name });
    } catch (e) {
      set({ views }); // 回滚
      throw e;        // 重抛，调用点 toast
    }
  },

  remove: async (id) => {
    const { views } = get();
    // 乐观移除
    set({ views: views.filter((v) => v.id !== id) });
    try {
      await softDeleteSavedView(id);
    } catch (e) {
      set({ views }); // 回滚
      throw e;        // 重抛，调用点 toast
    }
  },
}));
