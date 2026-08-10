// Memory PB SDK 数据访问层 —— 唯一允许调用 pb.collection("memories") 的文件。
// 组件 / Store 禁止直接调用 pb.collection；统一走此模块。
import { pb } from "../pb";
import { softDeleteRecord, NOT_DELETED } from "./collections";
import type { Memory } from "../../types/memory";

const COLL = "memories";

/** 全量记忆（跨项目，按更新时间倒序）。owner 范围由访问规则保证。 */
export function listMemories(): Promise<Memory[]> {
  return pb.collection(COLL).getFullList<Memory>({ requestKey: null, filter: NOT_DELETED, sort: "-updated" });
}

/** 创建记忆，返回完整记录。 */
export function createMemoryRecord(data: Record<string, unknown>): Promise<Memory> {
  return pb.collection(COLL).create<Memory>(data);
}

/** 更新记忆，返回完整记录。 */
export function updateMemoryRecord(id: string, data: Record<string, unknown>): Promise<Memory> {
  return pb.collection(COLL).update<Memory>(id, data);
}

/** 软删除记忆（写 deleted_at）。 */
export function deleteMemoryRecord(id: string): Promise<void> {
  return softDeleteRecord(COLL, id);
}
