import { create } from "zustand";
import type { Session } from "../types/session";
import { useSessionsStore } from "./sessions";
import { ipc } from "../lib/tauri/ipc";

// ── Store 状态类型 ─────────────────────────────────────────
interface SessionSearchState {
  query: string;
  results: Session[];
  /** 搜索历史（最近 20 条去重） */
  history: string[];
  loading: boolean;
  error?: string;
  /**
   * 执行搜索（防抖）。
   * 主路径：调用 Tantivy 全文检索（sessions_search），覆盖所有用户消息并按相关度排序，
   * 再按 session_id 映射回完整 Session 以复用 SessionCard。
   * 兜底：索引未就绪 / IPC 失败时回退到客户端过滤，保证搜索不“失灵”。
   */
  run: (q: string) => void;
}

/** 最大历史记录数 */
const MAX_HISTORY = 20;
/** 输入防抖（毫秒）——避免每次按键都发一次 IPC */
const DEBOUNCE_MS = 200;

/**
 * 客户端兜底过滤（Tantivy 索引未就绪 / IPC 失败时使用）。
 * 相比旧实现额外匹配 user_messages，尽量贴近全文检索的覆盖面。
 */
function clientFilter(all: Session[], lower: string): Session[] {
  return all.filter(
    (s) =>
      s.project_path.toLowerCase().includes(lower) ||
      s.session_id.toLowerCase().includes(lower) ||
      s.last_prompt.toLowerCase().includes(lower) ||
      s.first_prompt.toLowerCase().includes(lower) ||
      s.user_messages.some((m) => m.toLowerCase().includes(lower)),
  );
}

// 防抖定时器 + 请求序号（丢弃过期响应，避免慢查询覆盖新查询）
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

export const useSessionSearchStore = create<SessionSearchState>((set) => ({
  query: "",
  results: [],
  history: [],
  loading: false,
  error: undefined,

  run: (q: string) => {
    const trimmed = q.trim();
    // 立即回写 query，保证输入框即时响应（搜索本身走防抖）
    set({ query: trimmed });

    if (debounceTimer) clearTimeout(debounceTimer);

    if (!trimmed) {
      set({ results: [], loading: false, error: undefined });
      return;
    }

    set({ loading: true });
    const mySeq = ++seq;

    debounceTimer = setTimeout(() => {
      void (async () => {
        const all = useSessionsStore.getState().sessions;
        const byId = new Map(all.map((s) => [s.session_id, s]));
        const lower = trimmed.toLowerCase();

        let results: Session[];
        let error: string | undefined;
        try {
          // Tantivy 全文检索（覆盖所有用户消息，按相关度排序）
          const hits = await ipc.searchSessions(trimmed);
          // 命中映射回完整 Session，保持相关度顺序，丢弃缓存中已不存在的
          const mapped = hits
            .map((h) => byId.get(h.session_id))
            .filter((s): s is Session => Boolean(s));
          // 映射结果为空 → 多半是索引未就绪 → 回退客户端过滤
          results = mapped.length > 0 ? mapped : clientFilter(all, lower);
        } catch (e) {
          // IPC 失败也回退客户端过滤
          error = String(e);
          results = clientFilter(all, lower);
        }

        // 过期响应（用户已输入更新的查询）直接丢弃
        if (mySeq !== seq) return;

        set((state) => ({
          results,
          loading: false,
          error,
          history: [trimmed, ...state.history.filter((h) => h !== trimmed)].slice(
            0,
            MAX_HISTORY,
          ),
        }));
      })();
    }, DEBOUNCE_MS);
  },
}));
