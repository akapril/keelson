// Calendar PB SDK 数据访问层 —— 唯一允许调用 pb.collection 的 calendar 文件。
// 组件 / Store 禁止直接调用 pb.collection；统一走此模块。
import { pb } from "../pb";
import { COL, softDeleteRecord, NOT_DELETED, combineFilters } from "./collections";
import type { CalendarEvent } from "../../types/calendar";

// ── 列表查询 ──────────────────────────────────────────────

/**
 * 获取当前用户的全部日历事件（按 start 升序，时间靠前在前）。
 * calendar 仅按 owner 维度访问，无项目过滤 —— 访问权限由 PB 集合规则收口。
 */
export function listEvents(): Promise<CalendarEvent[]> {
  return pb.collection(COL.calendarEvents).getFullList<CalendarEvent>({
    requestKey: null,
    filter: NOT_DELETED,
    sort: "start",
  });
}

/** 获取关联到指定项目的事件（按 start 升序），用于项目工作台概览聚合。 */
export function listEventsByProject(
  projectId: string,
): Promise<CalendarEvent[]> {
  return pb.collection(COL.calendarEvents).getFullList<CalendarEvent>({
    requestKey: null,
    filter: combineFilters(NOT_DELETED, pb.filter("project = {:p}", { p: projectId })),
    sort: "start",
  });
}

// ── CRUD ─────────────────────────────────────────────────

/** 创建日历事件记录，返回创建后的完整记录 */
export function createEventRecord(
  data: Record<string, unknown>,
): Promise<CalendarEvent> {
  return pb.collection(COL.calendarEvents).create<CalendarEvent>(data);
}

/** 更新日历事件记录，返回更新后的完整记录 */
export function updateEventRecord(
  id: string,
  data: Record<string, unknown>,
): Promise<CalendarEvent> {
  return pb.collection(COL.calendarEvents).update<CalendarEvent>(id, data);
}

/** 软删除日历事件（写 deleted_at）。 */
export function deleteEventRecord(id: string): Promise<void> {
  return softDeleteRecord(COL.calendarEvents, id);
}

// ── 实时订阅 ──────────────────────────────────────────────

/**
 * 订阅当前用户的 calendar 实时变更。
 * 订阅通配主题 '*'，无过滤器 —— 范围由 PB owner-only 集合规则限定。
 * @returns 单一 unsubscribe 函数，调用后取消订阅。
 */
export async function subscribeEvents(
  onEvent: (action: string, rec: CalendarEvent) => void,
): Promise<() => void> {
  // PB subscribe 事件类型为 { action: string; record: CalendarEvent }
  const unsub = await pb
    .collection(COL.calendarEvents)
    .subscribe<CalendarEvent>("*", (e) => onEvent(e.action, e.record));

  // 返回聚合退订函数（当前仅一个订阅，保持与 docs 一致的形态）
  return () => {
    void unsub();
  };
}
