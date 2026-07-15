import { create } from "zustand";
import { COL, list, create as pbCreate, update as pbUpdate } from "../lib/pb/collections";
import { currentUserId } from "../lib/pb";

// ── PocketBase 记录类型（本文件内部使用） ─────────────────────
interface SessionMetaRecord {
  id: string;
  session_id: string;
  user_id: string;
  favorite: boolean;
  hidden: boolean;
  custom_name?: string;
}

interface SessionNoteRecord {
  id: string;
  session_id: string;
  user_id: string;
  content: string;
}

// ── Store 状态类型 ─────────────────────────────────────────
interface SessionMetaState {
  favorites: Set<string>;
  notes: Map<string, string>;
  loading: boolean;
  error?: string;
  /** 从 PocketBase 加载全部 meta 和 notes */
  load: () => Promise<void>;
  /** 切换收藏状态（写回 PocketBase） */
  toggleFavorite: (sessionId: string) => Promise<void>;
  /** 保存会话笔记（写回 PocketBase） */
  setNote: (sessionId: string, text: string) => Promise<void>;
}

/** session_id -> PocketBase record id 的本地缓存（用于 update） */
let metaRecordMap: Map<string, string> = new Map();
let noteRecordMap: Map<string, string> = new Map();

export const useSessionMetaStore = create<SessionMetaState>((set, get) => ({
  favorites: new Set(),
  notes: new Map(),
  loading: false,
  error: undefined,

  load: async () => {
    set({ loading: true, error: undefined });
    try {
      const userId = currentUserId();
      // 读取 sessions_meta
      const metaRows = await list<SessionMetaRecord>(COL.sessionsMeta, {
        filter: `user_id="${userId}"`,
      });
      const favorites = new Set<string>();
      metaRecordMap = new Map();
      for (const row of metaRows) {
        if (row.favorite) favorites.add(row.session_id);
        metaRecordMap.set(row.session_id, row.id);
      }

      // 读取 session_notes
      const noteRows = await list<SessionNoteRecord>(COL.sessionNotes, {
        filter: `user_id="${userId}"`,
      });
      const notes = new Map<string, string>();
      noteRecordMap = new Map();
      for (const row of noteRows) {
        notes.set(row.session_id, row.content);
        noteRecordMap.set(row.session_id, row.id);
      }

      set({ favorites, notes, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  toggleFavorite: async (sessionId) => {
    const { favorites } = get();
    const isFav = favorites.has(sessionId);
    // 乐观更新
    const next = new Set(favorites);
    if (isFav) next.delete(sessionId); else next.add(sessionId);
    set({ favorites: next });

    try {
      const userId = currentUserId();
      const recordId = metaRecordMap.get(sessionId);
      if (recordId) {
        // 已有记录：更新
        await pbUpdate(COL.sessionsMeta, recordId, { favorite: !isFav });
      } else {
        // 无记录：新建
        const row = await pbCreate<SessionMetaRecord>(COL.sessionsMeta, {
          session_id: sessionId,
          user_id: userId,
          favorite: !isFav,
          hidden: false,
        });
        metaRecordMap.set(sessionId, row.id);
      }
    } catch (e) {
      // 回滚乐观更新
      set({ favorites, error: String(e) });
    }
  },

  setNote: async (sessionId, text) => {
    const { notes } = get();
    // 乐观更新
    const next = new Map(notes);
    next.set(sessionId, text);
    set({ notes: next });

    try {
      const userId = currentUserId();
      const recordId = noteRecordMap.get(sessionId);
      if (recordId) {
        await pbUpdate(COL.sessionNotes, recordId, { content: text });
      } else {
        const row = await pbCreate<SessionNoteRecord>(COL.sessionNotes, {
          session_id: sessionId,
          user_id: userId,
          content: text,
        });
        noteRecordMap.set(sessionId, row.id);
      }
    } catch (e) {
      // 回滚
      set({ notes, error: String(e) });
    }
  },
}));
