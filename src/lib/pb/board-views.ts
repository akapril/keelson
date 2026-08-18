// board_views PB 数据访问层 —— 唯一允许调用 pb.collection('board_views') 的文件。
// 组件 / Store 禁止直接调用 pb.collection；统一走此模块。
import { pb, currentUserId } from "../pb";
import { softDeleteRecord, NOT_DELETED, combineFilters } from "./collections";
import type { SavedBoardView } from "../../types/board-view-saved";

const COLL = "board_views";

// ── 查询辅助 ──────────────────────────────────────────────

/** 按项目 ID 精确过滤（一对多，project 字段为单值 relation）。 */
const byProject = (projectId: string) =>
  pb.filter("project = {:p}", { p: projectId });

// ── 列表查询 ──────────────────────────────────────────────

/**
 * 获取指定项目的已保存视图（未软删，按 sort_order 升序、created 升序）。
 * owner 范围由 PB 访问规则保证（只返回当前用户自己的记录）。
 */
export function listSavedViews(projectId: string): Promise<SavedBoardView[]> {
  return pb.collection(COLL).getFullList<SavedBoardView>({
    requestKey: null,
    filter: combineFilters(NOT_DELETED, byProject(projectId)),
    sort: "sort_order,created",
  });
}

// ── CRUD ─────────────────────────────────────────────────

/** 创建保存视图；owner 由当前登录用户注入（与 agents.ts 范式一致）。 */
export function createSavedView(
  input: Omit<SavedBoardView, "id" | "owner" | "deleted_at" | "created" | "updated">,
): Promise<SavedBoardView> {
  return pb.collection(COLL).create<SavedBoardView>({
    ...input,
    owner: currentUserId(),
  });
}

/** 更新保存视图（部分字段），返回更新后的完整记录。 */
export function updateSavedView(
  id: string,
  patch: Partial<Omit<SavedBoardView, "id" | "owner" | "project" | "created" | "updated">>,
): Promise<SavedBoardView> {
  return pb.collection(COLL).update<SavedBoardView>(id, patch as Record<string, unknown>);
}

/**
 * 软删除保存视图：写 deleted_at（tombstone 范式，不物理删除）。
 * 与 docs.ts / agents.ts 一致，均走 collections.ts 的 softDeleteRecord。
 */
export function softDeleteSavedView(id: string): Promise<void> {
  return softDeleteRecord(COLL, id);
}
