// Reading PB SDK 数据访问层 —— 唯一允许调用 pb.collection 的 reading 文件。
// 组件 / Store 禁止直接调用 pb.collection；统一走此模块。
import { pb } from "../pb";
import { COL, softDeleteRecord, NOT_DELETED } from "./collections";
import type { ReadingItem } from "../../types/reading";

// ── 列表查询 ──────────────────────────────────────────────

/**
 * 获取当前用户的全部阅读条目（按 updated 降序，最近更新在前）。
 * reading 仅按 owner 维度访问，无项目过滤 —— 访问权限由 PB 集合规则收口。
 */
export function listReadingItems(): Promise<ReadingItem[]> {
  return pb.collection(COL.readingItems).getFullList<ReadingItem>({
    requestKey: null,
    filter: NOT_DELETED,
    sort: "-updated",
  });
}

// ── CRUD ─────────────────────────────────────────────────

/** 创建阅读条目记录，返回创建后的完整记录 */
export function createReadingRecord(
  data: Record<string, unknown>,
): Promise<ReadingItem> {
  return pb.collection(COL.readingItems).create<ReadingItem>(data);
}

/** 更新阅读条目记录，返回更新后的完整记录 */
export function updateReadingRecord(
  id: string,
  data: Record<string, unknown>,
): Promise<ReadingItem> {
  return pb.collection(COL.readingItems).update<ReadingItem>(id, data);
}

/** 软删除阅读条目（写 deleted_at）。 */
export function deleteReadingRecord(id: string): Promise<void> {
  return softDeleteRecord(COL.readingItems, id);
}

// ── 实时订阅 ──────────────────────────────────────────────

/**
 * 订阅当前用户的 reading 实时变更。
 * 订阅通配主题 '*'，无过滤器 —— 范围由 PB owner-only 集合规则限定。
 * @returns 单一 unsubscribe 函数，调用后取消订阅。
 */
export async function subscribeReading(
  onEvent: (action: string, rec: ReadingItem) => void,
): Promise<() => void> {
  // PB subscribe 事件类型为 { action: string; record: ReadingItem }
  const unsub = await pb
    .collection(COL.readingItems)
    .subscribe<ReadingItem>("*", (e) => onEvent(e.action, e.record));

  // 返回聚合退订函数（当前仅一个订阅，保持与 docs 一致的形态）
  return () => {
    void unsub();
  };
}
