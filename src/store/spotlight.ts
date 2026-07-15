import { create } from "zustand";
import type { Session } from "../types/session";

// ── Spotlight 候选项类型 ───────────────────────────────────
export interface SpotlightItem {
  session: Session;
  label: string;
}

// ── Store 状态类型 ─────────────────────────────────────────
interface SpotlightState {
  query: string;
  selectedIndex: number;
  items: SpotlightItem[];
  loading: boolean;
  error?: string;
  /** 更新搜索关键词，并重置选中索引 */
  setQuery: (q: string) => void;
  /** 上下移动选中项（"up" | "down"） */
  move: (dir: "up" | "down") => void;
  /** 由外部（搜索结果或会话列表）设置候选项 */
  setItems: (items: SpotlightItem[]) => void;
}

export const useSpotlightStore = create<SpotlightState>((set, get) => ({
  query: "",
  selectedIndex: 0,
  items: [],
  loading: false,
  error: undefined,

  setQuery: (query) => set({ query, selectedIndex: 0 }),

  move: (dir) => {
    const { selectedIndex, items } = get();
    if (items.length === 0) return;
    if (dir === "down") {
      set({ selectedIndex: (selectedIndex + 1) % items.length });
    } else {
      set({ selectedIndex: (selectedIndex - 1 + items.length) % items.length });
    }
  },

  setItems: (items) => set({ items, selectedIndex: 0 }),
}));
