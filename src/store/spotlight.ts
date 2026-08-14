import { create } from "zustand";
import type { Session } from "../types/session";

// ── Spotlight 候选项类型（联合：会话 / 任务 / 文档） ─────────────
/** 会话候选：Enter 恢复终端（asTab 决定新窗/标签）。 */
export interface SessionSpotlightItem {
  kind: "session";
  label: string;
  session: Session;
}
/** 导航候选（任务/文档/项目/记忆）：Enter 聚焦主窗并跳转到深链。 */
export interface NavSpotlightItem {
  kind: "task" | "doc" | "project" | "memory";
  label: string;
  /** 主窗要导航到的深链，如 /board?open=<pid>&tab=board 或 /memory?open=<id> */
  path: string;
}
export type SpotlightItem = SessionSpotlightItem | NavSpotlightItem;

// ── 类别（六 tab：全部/会话/项目/文档/任务/记忆） ─────────────
/** Spotlight 类别标识。 */
export type SpotlightCategory = "all" | "session" | "project" | "doc" | "task" | "memory";
/** 类别顺序（chips 展示序 + ⌘1-6 直达序 + Tab 循环序），单一事实源。 */
export const CATEGORIES: readonly SpotlightCategory[] = [
  "all",
  "session",
  "project",
  "doc",
  "task",
  "memory",
];
/** 循环切换类别：next 向后、prev 向前，两端环绕。 */
export function nextCategory(cur: SpotlightCategory, dir: "next" | "prev"): SpotlightCategory {
  const i = CATEGORIES.indexOf(cur);
  const n = CATEGORIES.length;
  const j = dir === "next" ? (i + 1) % n : (i - 1 + n) % n;
  return CATEGORIES[j];
}

// ── Store 状态类型 ─────────────────────────────────────────
interface SpotlightState {
  query: string;
  selectedIndex: number;
  items: SpotlightItem[];
  loading: boolean;
  error?: string;
  /** 恢复模式：false=新终端窗，true=作为标签页（Tab 切换，键盘/鼠标共用） */
  asTab: boolean;
  /** 当前类别（tab）；默认 all=混合搜索。 */
  category: SpotlightCategory;
  /** 更新搜索关键词，并重置选中索引 */
  setQuery: (q: string) => void;
  /** 上下移动选中项（"up" | "down"） */
  move: (dir: "up" | "down") => void;
  /** 直接设置选中索引（鼠标悬停跟随用） */
  setSelectedIndex: (i: number) => void;
  /** 切换恢复模式 */
  toggleAsTab: () => void;
  /** 直接设置类别（chips 点选 / ⌘数字直达）；保留 query 作为该类过滤词。 */
  setCategory: (c: SpotlightCategory) => void;
  /** 循环切换类别（Tab/Shift+Tab）。 */
  cycleCategory: (dir: "next" | "prev") => void;
  /** 由外部（搜索结果或会话列表）设置候选项 */
  setItems: (items: SpotlightItem[]) => void;
}

export const useSpotlightStore = create<SpotlightState>((set, get) => ({
  query: "",
  selectedIndex: 0,
  items: [],
  loading: false,
  error: undefined,
  asTab: false,
  category: "all",

  setQuery: (query) => set({ query, selectedIndex: 0 }),
  setSelectedIndex: (selectedIndex) => set({ selectedIndex }),
  toggleAsTab: () => set((s) => ({ asTab: !s.asTab })),

  move: (dir) => {
    const { selectedIndex, items } = get();
    if (items.length === 0) return;
    if (dir === "down") {
      set({ selectedIndex: (selectedIndex + 1) % items.length });
    } else {
      set({ selectedIndex: (selectedIndex - 1 + items.length) % items.length });
    }
  },

  setCategory: (category) => set({ category, selectedIndex: 0 }),
  cycleCategory: (dir) => set((s) => ({ category: nextCategory(s.category, dir), selectedIndex: 0 })),

  setItems: (items) => set({ items, selectedIndex: 0 }),
}));
