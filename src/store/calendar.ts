// Calendar Zustand Store —— 日历事件状态管理 + CRUD（乐观更新 + 回滚）。
// 数据访问统一走 src/lib/pb/calendar.ts，本文件不直接调用 pb.collection。
import { create } from "zustand";
import {
  listEvents,
  createEventRecord,
  updateEventRecord,
  deleteEventRecord,
  subscribeEvents,
} from "../lib/pb/calendar";
import { currentUserId } from "../lib/pb";
import { isTombstoned } from "../lib/pb/tombstone";
import type { CalendarEvent } from "../types/calendar";

// ── 实时订阅的退订句柄（模块级，仅保留当前一个订阅） ──
let unsub: (() => void) | null = null;

/** 按 start 升序排序（时间靠前在前），与列表查询保持一致的顺序 */
function sortByStartAsc(list: CalendarEvent[]): CalendarEvent[] {
  return list.slice().sort((a, b) => (a.start > b.start ? 1 : -1));
}

/** upsert：按 id 替换，不存在则追加，随后按 start 升序排序（使实时 echo 幂等） */
function upsertById(list: CalendarEvent[], rec: CalendarEvent): CalendarEvent[] {
  const idx = list.findIndex((x) => x.id === rec.id);
  const next = idx === -1 ? [...list, rec] : list.slice();
  if (idx !== -1) next[idx] = rec;
  return sortByStartAsc(next);
}

/** remove：按 id 过滤移除 */
function removeById(list: CalendarEvent[], id: string): CalendarEvent[] {
  return list.filter((x) => x.id !== id);
}

// ── Store 状态类型 ─────────────────────────────────────────
interface CalendarStoreState {
  /** 当前用户的日历事件（按 start 升序） */
  events: CalendarEvent[];
  /** 数据加载中 */
  loading: boolean;
  /** 最近一次错误信息 */
  error?: string;

  // ── 动作 ────────────────────────────────────────────────
  /** 加载日历事件列表并订阅实时变更（拆除上一个订阅） */
  load: () => Promise<void>;
  /**
   * 新建日历事件（owner = 当前用户）。
   * 默认：end 空串、all_day false、color 空串、description 空串；upsert 到列表。
   */
  addEvent: (input: {
    title: string;
    start: string;
    end?: string;
    /** 开始时刻 "HH:mm"（可选，all_day 时忽略） */
    start_time?: string;
    /** 结束时刻 "HH:mm"（可选，all_day 时忽略） */
    end_time?: string;
    all_day?: boolean;
    color?: string;
    description?: string;
    project?: string;
    repeat?: string;
  }) => Promise<CalendarEvent>;
  /** 更新日历事件字段（乐观更新 + 回滚） */
  updateEvent: (
    id: string,
    patch: Partial<
      Pick<
        CalendarEvent,
        | "title"
        | "start"
        | "end"
        | "start_time"
        | "end_time"
        | "all_day"
        | "color"
        | "description"
        | "project"
        | "repeat"
      >
    >,
  ) => Promise<void>;
  /** 删除日历事件（乐观移除 + 回滚） */
  removeEvent: (id: string) => Promise<void>;
  /** 关闭：取消实时订阅并清空状态 */
  close: () => void;
}

// ── Store 实现 ─────────────────────────────────────────────
export const useCalendarStore = create<CalendarStoreState>((set, get) => ({
  events: [],
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
      const events = await listEvents();
      set({ events, loading: false });
      // 加载成功后订阅实时变更；upsert-by-id 使 echo 幂等
      unsub = await subscribeEvents((action, rec) =>
        set((s) => ({
          events:
            action === "delete" || isTombstoned(rec)
              ? removeById(s.events, rec.id)
              : upsertById(s.events, rec),
        })),
      );
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  // ── 新建事件 ─────────────────────────────────────────────
  addEvent: async (input) => {
    const created = await createEventRecord({
      owner: currentUserId(),
      title: input.title,
      start: input.start,
      end: input.end ?? "", // end 默认空串
      start_time: input.start_time ?? "", // 开始时刻默认空串
      end_time: input.end_time ?? "", // 结束时刻默认空串
      all_day: input.all_day ?? false, // 默认非全天
      color: input.color ?? "", // color 默认空串
      description: input.description ?? "", // description 默认空串
      project: input.project ?? "", // 关联项目默认空串
      repeat: input.repeat ?? "", // 重复规则默认空串（不重复）
    });
    // 按 id upsert（去重）：PB 实时 create 事件可能在 await 期间已插入同一条，
    // 避免本地再追加一次造成重复。
    set((s) => ({ events: upsertById(s.events, created) }));
    return created;
  },

  // ── 更新事件（乐观 + PB 写回） ──────────────────────────
  updateEvent: async (id, patch) => {
    const { events } = get();
    // 乐观更新本地状态
    set({
      events: events.map((ev) => (ev.id === id ? { ...ev, ...patch } : ev)),
    });
    try {
      await updateEventRecord(id, patch as Record<string, unknown>);
    } catch (e) {
      // 回滚并重抛，让调用方能感知失败（不再误报成功）
      set({ events, error: String(e) });
      throw e;
    }
  },

  // ── 删除事件（乐观移除 + 回滚） ─────────────────────────
  removeEvent: async (id) => {
    const { events } = get();
    // 乐观移除
    set({ events: events.filter((ev) => ev.id !== id) });
    try {
      await deleteEventRecord(id);
    } catch (e) {
      // 回滚并重抛
      set({ events, error: String(e) });
      throw e;
    }
  },

  // ── 关闭（退订 + 清空状态） ──────────────────────────────
  close: () => {
    // 取消实时订阅并释放句柄
    unsub?.();
    unsub = null;
    set({ events: [], error: undefined });
  },
}));
