import { create } from "zustand";
import type { Session } from "../types/session";
import { useSessionsStore } from "./sessions";

// ── Store 状态类型 ─────────────────────────────────────────
interface SessionSearchState {
  query: string;
  results: Session[];
  /** 搜索历史（最近 20 条去重） */
  history: string[];
  loading: boolean;
  error?: string;
  /**
   * 执行搜索。
   * MVP：对 useSessionsStore.sessions 进行客户端过滤，
   * 匹配 project_path / summary / id（不调用 ipc.searchSessions）。
   */
  run: (q: string) => void;
}

/** 最大历史记录数 */
const MAX_HISTORY = 20;

export const useSessionSearchStore = create<SessionSearchState>((set) => ({
  query: "",
  results: [],
  history: [],
  loading: false,
  error: undefined,

  run: (q: string) => {
    const trimmed = q.trim();
    set({ query: trimmed });

    if (!trimmed) {
      set({ results: [] });
      return;
    }

    // 客户端过滤（MVP 阶段不调用 ipc.searchSessions）
    const allSessions = useSessionsStore.getState().sessions;
    const lower = trimmed.toLowerCase();
    const results = allSessions.filter(
      (s) =>
        s.project_path.toLowerCase().includes(lower) ||
        s.id.toLowerCase().includes(lower) ||
        (s.summary ?? "").toLowerCase().includes(lower),
    );

    // 更新搜索历史（去重 + 截断）
    set((state) => {
      const next = [trimmed, ...state.history.filter((h) => h !== trimmed)].slice(
        0,
        MAX_HISTORY,
      );
      return { results, history: next };
    });
  },
}));
