import { create } from "zustand";
import { COL, list, create as pbCreate, update as pbUpdate } from "../lib/pb/collections";
import { currentUserId } from "../lib/pb";

// ── PocketBase 记录类型（本文件内部使用） ─────────────────────
interface SessionMetaRecord {
  id: string;
  session_id: string;
  owner: string;      // PB schema 字段名为 owner（relation → users），非 user_id
  favorite: boolean;
  hidden: boolean;
  custom_name?: string;
}

interface SessionNoteRecord {
  id: string;
  session_id: string;
  owner: string;      // PB schema 字段名为 owner（relation → users），非 user_id
  content: string;
}

// ── Store 状态类型 ─────────────────────────────────────────
interface SessionMetaState {
  favorites: Set<string>;
  /** 已隐藏的会话 id（列表默认不显示；用于收纳噪音会话） */
  hidden: Set<string>;
  notes: Map<string, string>;
  /** session_id -> 自定义名称（custom_name，覆盖显示用；空表示未设） */
  customNames: Map<string, string>;
  loading: boolean;
  error?: string;
  /** 从 PocketBase 加载全部 meta 和 notes */
  load: () => Promise<void>;
  /** 切换收藏状态（写回 PocketBase） */
  toggleFavorite: (sessionId: string) => Promise<void>;
  /** 切换隐藏状态（写回 PocketBase） */
  toggleHidden: (sessionId: string) => Promise<void>;
  /** 保存会话笔记（写回 PocketBase） */
  setNote: (sessionId: string, text: string) => Promise<void>;
  /** 设置/清除会话自定义名称（写回 PocketBase；空串=清除） */
  setCustomName: (sessionId: string, name: string) => Promise<void>;
}

/** session_id -> PocketBase record id 的本地缓存（用于 update） */
let metaRecordMap: Map<string, string> = new Map();
let noteRecordMap: Map<string, string> = new Map();

export const useSessionMetaStore = create<SessionMetaState>((set, get) => ({
  favorites: new Set(),
  hidden: new Set(),
  notes: new Map(),
  customNames: new Map(),
  loading: false,
  error: undefined,

  load: async () => {
    set({ loading: true, error: undefined });
    try {
      const userId = currentUserId();
      // 读取 sessions_meta（filter 使用 PB schema 字段 owner）
      const metaRows = await list<SessionMetaRecord>(COL.sessionsMeta, {
        filter: `owner="${userId}"`,
      });
      const favorites = new Set<string>();
      const hidden = new Set<string>();
      const customNames = new Map<string, string>();
      metaRecordMap = new Map();
      for (const row of metaRows) {
        if (row.favorite) favorites.add(row.session_id);
        if (row.hidden) hidden.add(row.session_id);
        if (row.custom_name) customNames.set(row.session_id, row.custom_name);
        metaRecordMap.set(row.session_id, row.id);
      }

      // 读取 session_notes（filter 使用 PB schema 字段 owner）
      const noteRows = await list<SessionNoteRecord>(COL.sessionNotes, {
        filter: `owner="${userId}"`,
      });
      const notes = new Map<string, string>();
      noteRecordMap = new Map();
      for (const row of noteRows) {
        notes.set(row.session_id, row.content);
        noteRecordMap.set(row.session_id, row.id);
      }

      set({ favorites, hidden, notes, customNames, loading: false });
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
        // 无记录：新建（Rust sync_to_pb 通常已预建此行，此分支仅防御性兜底）
        const row = await pbCreate<SessionMetaRecord>(COL.sessionsMeta, {
          session_id: sessionId,
          owner: userId,     // PB schema 要求 owner 字段（createRule 校验 owner = auth.id）
          favorite: !isFav,
          hidden: false,
        });
        metaRecordMap.set(sessionId, row.id);
      }
    } catch (e) {
      // 回滚乐观更新并重抛，让调用方能感知失败
      set({ favorites, error: String(e) });
      throw e;
    }
  },

  toggleHidden: async (sessionId) => {
    const { hidden } = get();
    const isHidden = hidden.has(sessionId);
    // 乐观更新
    const next = new Set(hidden);
    if (isHidden) next.delete(sessionId);
    else next.add(sessionId);
    set({ hidden: next });

    try {
      const userId = currentUserId();
      const recordId = metaRecordMap.get(sessionId);
      if (recordId) {
        await pbUpdate(COL.sessionsMeta, recordId, { hidden: !isHidden });
      } else {
        // 无记录：新建（防御性兜底，与 toggleFavorite 一致）
        const row = await pbCreate<SessionMetaRecord>(COL.sessionsMeta, {
          session_id: sessionId,
          owner: userId,
          favorite: false,
          hidden: !isHidden,
        });
        metaRecordMap.set(sessionId, row.id);
      }
    } catch (e) {
      // 回滚并重抛
      set({ hidden, error: String(e) });
      throw e;
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
        // 无记录：新建（owner 字段，满足 createRule 校验）
        const row = await pbCreate<SessionNoteRecord>(COL.sessionNotes, {
          session_id: sessionId,
          owner: userId,     // PB schema 要求 owner 字段（createRule 校验 owner = auth.id）
          content: text,
        });
        noteRecordMap.set(sessionId, row.id);
      }
    } catch (e) {
      // 回滚并重抛
      set({ notes, error: String(e) });
      throw e;
    }
  },

  setCustomName: async (sessionId, name) => {
    const { customNames } = get();
    const trimmed = name.trim();
    // 乐观更新：空串=清除
    const next = new Map(customNames);
    if (trimmed) next.set(sessionId, trimmed);
    else next.delete(sessionId);
    set({ customNames: next });

    try {
      const userId = currentUserId();
      const recordId = metaRecordMap.get(sessionId);
      if (recordId) {
        await pbUpdate(COL.sessionsMeta, recordId, { custom_name: trimmed });
      } else {
        // 无记录：新建（owner + 必填字段，满足 createRule）
        const row = await pbCreate<SessionMetaRecord>(COL.sessionsMeta, {
          session_id: sessionId,
          owner: userId,
          favorite: false,
          hidden: false,
          custom_name: trimmed,
        });
        metaRecordMap.set(sessionId, row.id);
      }
    } catch (e) {
      // 回滚并重抛
      set({ customNames, error: String(e) });
      throw e;
    }
  },
}));
