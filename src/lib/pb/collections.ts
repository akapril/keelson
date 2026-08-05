import { pb } from "../pb";
export const COL = {
  sessionsMeta: "sessions_meta",
  sessionTags: "session_tags",
  sessionNotes: "session_notes",
  boardProjects: "board_projects",
  boardStates: "board_project_states",
  boardLabels: "board_project_labels",
  boardTasks: "board_tasks",
  boardMembers: "board_project_members",
  boardTemplates: "board_templates",
  docs: "docs",
  docAssets: "doc_assets",
  readingItems: "reading_items",
  calendarEvents: "calendar_events",
  notifications: "notifications",
} as const;
export const list = <T>(coll: string, opts: Record<string, unknown> = {}) =>
  pb.collection(coll).getFullList<T>({ requestKey: null, ...opts });
export const create = <T>(coll: string, data: Record<string, unknown>) =>
  pb.collection(coll).create<T>(data);
export const update = <T>(coll: string, id: string, data: Record<string, unknown>) =>
  pb.collection(coll).update<T>(id, data);

// ── 软删除(tombstone)基础设施 ──────────────────────────────
// 未删过滤：PB date 空值序列化为 ""，故"未删"= deleted_at 为空串。
// 集中为常量，若某 PB 版本对空 date 过滤语义不同，只改此一处。
export const NOT_DELETED = 'deleted_at = ""';

/** 当前时刻 ISO 字符串（写 deleted_at 用）。 */
export const nowIso = (): string => new Date().toISOString();

/** 用 && 连接非空 filter 片段；全空返回空串。 */
export function combineFilters(...parts: (string | undefined)[]): string {
  return parts.filter((p): p is string => !!p && p.length > 0).join(" && ");
}

/** 软删除：写 deleted_at 而非物理删除（同步集合专用）。 */
export function softDeleteRecord(coll: string, id: string): Promise<void> {
  return pb.collection(coll).update(id, { deleted_at: nowIso() }).then(() => undefined);
}
