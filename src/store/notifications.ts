import { create } from "zustand";
import {
  listNotifications,
  createNotification,
  setNotificationRead,
  deleteNotification,
  subscribeNotifications,
  type CreateNotificationInput,
} from "../lib/pb/notifications";
import type { AppNotification } from "../types/notifications";

// 实时订阅句柄（模块级，仅订阅一次）
let unsub: (() => void) | null = null;
let subscribing = false;

/** upsert：按 id 替换，不存在则前插（最新在前）；使实时 echo 幂等。 */
function upsertById(list: AppNotification[], rec: AppNotification): AppNotification[] {
  const idx = list.findIndex((x) => x.id === rec.id);
  if (idx === -1) return [rec, ...list];
  const next = list.slice();
  next[idx] = rec;
  return next;
}

interface NotificationsState {
  items: AppNotification[];
  loading: boolean;
  error?: string;
  /** 未读数量（红标依据） */
  unreadCount: () => number;
  load: () => Promise<void>;
  /** 推送一条通知（更新/AI/沉淀等来源用） */
  add: (input: CreateNotificationInput) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  /** 批量标记已读（收件箱批处理） */
  markManyRead: (ids: string[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** 批量删除/归档（收件箱批处理） */
  removeMany: (ids: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: [],
  loading: false,
  error: undefined,

  unreadCount: () => get().items.filter((n) => !n.read).length,

  load: async () => {
    set({ loading: true, error: undefined });
    try {
      const items = await listNotifications();
      set({ items, loading: false });
      // 首次加载后订阅实时（仅一次）
      if (!unsub && !subscribing) {
        subscribing = true;
        unsub = await subscribeNotifications((action, rec) => {
          set((s) => ({
            items:
              action === "delete"
                ? s.items.filter((x) => x.id !== rec.id)
                : upsertById(s.items, rec),
          }));
        }).catch(() => null);
        subscribing = false;
      }
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  add: async (input) => {
    const created = await createNotification(input);
    // upsert 去重（实时 create echo 可能已插入）
    set((s) => ({ items: upsertById(s.items, created) }));
  },

  markRead: async (id) => {
    const snapshot = get().items;
    set({ items: snapshot.map((n) => (n.id === id ? { ...n, read: true } : n)) });
    try {
      await setNotificationRead(id, true);
    } catch (e) {
      set({ items: snapshot, error: String(e) });
    }
  },

  markAllRead: async () => {
    const snapshot = get().items;
    const unread = snapshot.filter((n) => !n.read);
    if (unread.length === 0) return;
    set({ items: snapshot.map((n) => (n.read ? n : { ...n, read: true })) });
    try {
      await Promise.all(unread.map((n) => setNotificationRead(n.id, true)));
    } catch (e) {
      set({ items: snapshot, error: String(e) });
    }
  },

  markManyRead: async (ids) => {
    const idSet = new Set(ids);
    const snapshot = get().items;
    const targets = snapshot.filter((n) => idSet.has(n.id) && !n.read);
    if (targets.length === 0) return;
    set({ items: snapshot.map((n) => (idSet.has(n.id) ? { ...n, read: true } : n)) });
    try {
      await Promise.all(targets.map((n) => setNotificationRead(n.id, true)));
    } catch (e) {
      set({ items: snapshot, error: String(e) });
    }
  },

  remove: async (id) => {
    const snapshot = get().items;
    set({ items: snapshot.filter((n) => n.id !== id) });
    try {
      await deleteNotification(id);
    } catch (e) {
      set({ items: snapshot, error: String(e) });
    }
  },

  removeMany: async (ids) => {
    const idSet = new Set(ids);
    const snapshot = get().items;
    if (!snapshot.some((n) => idSet.has(n.id))) return;
    set({ items: snapshot.filter((n) => !idSet.has(n.id)) });
    try {
      await Promise.all([...idSet].map((id) => deleteNotification(id)));
    } catch (e) {
      set({ items: snapshot, error: String(e) });
    }
  },

  clearAll: async () => {
    const snapshot = get().items;
    if (snapshot.length === 0) return;
    set({ items: [] });
    try {
      await Promise.all(snapshot.map((n) => deleteNotification(n.id)));
    } catch (e) {
      set({ items: snapshot, error: String(e) });
    }
  },
}));
