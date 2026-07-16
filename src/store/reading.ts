// Reading Zustand Store —— 阅读列表状态管理 + CRUD（乐观更新 + 回滚）。
// 数据访问统一走 src/lib/pb/reading.ts，本文件不直接调用 pb.collection。
import { create } from "zustand";
import {
  listReadingItems,
  createReadingRecord,
  updateReadingRecord,
  deleteReadingRecord,
  subscribeReading,
} from "../lib/pb/reading";
import { currentUserId } from "../lib/pb";
import type { ReadingItem } from "../types/reading";

// ── 实时订阅的退订句柄（模块级，仅保留当前一个订阅） ──
let unsub: (() => void) | null = null;

/** 按 updated 降序排序（最近更新在前），与列表查询保持一致的顺序 */
function sortByUpdatedDesc(list: ReadingItem[]): ReadingItem[] {
  return list.slice().sort((a, b) => (a.updated < b.updated ? 1 : -1));
}

/** upsert：按 id 替换，不存在则追加，随后按 updated 降序排序（使实时 echo 幂等） */
function upsertById(list: ReadingItem[], rec: ReadingItem): ReadingItem[] {
  const idx = list.findIndex((x) => x.id === rec.id);
  const next = idx === -1 ? [...list, rec] : list.slice();
  if (idx !== -1) next[idx] = rec;
  return sortByUpdatedDesc(next);
}

/** remove：按 id 过滤移除 */
function removeById(list: ReadingItem[], id: string): ReadingItem[] {
  return list.filter((x) => x.id !== id);
}

// ── Store 状态类型 ─────────────────────────────────────────
interface ReadingStoreState {
  /** 当前用户的阅读条目（按 updated 降序） */
  items: ReadingItem[];
  /** 数据加载中 */
  loading: boolean;
  /** 最近一次错误信息 */
  error?: string;

  // ── 动作 ────────────────────────────────────────────────
  /** 加载阅读条目列表并订阅实时变更（拆除上一个订阅） */
  load: () => Promise<void>;
  /** 新建阅读条目（owner = 当前用户，status = unread，url/note 默认空串）；upsert 到列表 */
  addItem: (input: {
    title: string;
    url?: string;
    note?: string;
  }) => Promise<ReadingItem>;
  /** 更新阅读条目字段（乐观更新 + 回滚） */
  updateItem: (
    id: string,
    patch: Partial<Pick<ReadingItem, "title" | "url" | "note" | "status">>,
  ) => Promise<void>;
  /** 删除阅读条目（乐观移除 + 回滚） */
  removeItem: (id: string) => Promise<void>;
  /** 关闭：取消实时订阅并清空状态 */
  close: () => void;
}

// ── Store 实现 ─────────────────────────────────────────────
export const useReadingStore = create<ReadingStoreState>((set, get) => ({
  items: [],
  loading: false,
  error: undefined,

  // ── 加载（列表 + 实时订阅） ─────────────────────────────
  load: async () => {
    // 重新加载前先取消上一个订阅，避免泄漏
    if (unsub) {
      unsub();
      unsub = null;
    }
    set({ loading: true, error: undefined });
    try {
      const items = await listReadingItems();
      set({ items, loading: false });
      // 加载成功后订阅实时变更；upsert-by-id 使 echo 幂等
      unsub = await subscribeReading((action, rec) =>
        set((s) => ({
          items:
            action === "delete"
              ? removeById(s.items, rec.id)
              : upsertById(s.items, rec),
        })),
      );
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  // ── 新建条目 ─────────────────────────────────────────────
  addItem: async (input) => {
    const created = await createReadingRecord({
      owner: currentUserId(),
      title: input.title,
      url: input.url ?? "", // url 默认空串
      note: input.note ?? "", // note 默认空串
      status: "unread", // 新建默认未读
    });
    // 按 id upsert（去重）：PB 实时 create 事件可能在 await 期间已插入同一条，
    // 避免本地再追加一次造成重复。
    set((s) => ({ items: upsertById(s.items, created) }));
    return created;
  },

  // ── 更新条目（乐观 + PB 写回） ──────────────────────────
  updateItem: async (id, patch) => {
    const { items } = get();
    // 乐观更新本地状态
    set({
      items: items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    });
    try {
      await updateReadingRecord(id, patch as Record<string, unknown>);
    } catch (e) {
      // 回滚
      set({ items, error: String(e) });
    }
  },

  // ── 删除条目（乐观移除 + 回滚） ─────────────────────────
  removeItem: async (id) => {
    const { items } = get();
    // 乐观移除
    set({ items: items.filter((it) => it.id !== id) });
    try {
      await deleteReadingRecord(id);
    } catch (e) {
      // 回滚
      set({ items, error: String(e) });
    }
  },

  // ── 关闭（退订 + 清空状态） ──────────────────────────────
  close: () => {
    // 取消实时订阅并释放句柄
    unsub?.();
    unsub = null;
    set({ items: [], error: undefined });
  },
}));
