// Docs PB SDK 数据访问层 —— 唯一允许调用 pb.collection 的 docs 文件。
// 组件 / Store 禁止直接调用 pb.collection；统一走此模块。
import { pb } from "../pb";
import { COL } from "./collections";
import type { BoardDoc } from "../../types/docs";

// ── 查询辅助 ──────────────────────────────────────────────
/** 按项目 ID 过滤的 PB filter 字符串 */
const byProject = (projectId: string) =>
  pb.filter("project = {:p}", { p: projectId });

// ── 列表查询 ──────────────────────────────────────────────

/** 获取指定项目的文档（按 updated 降序，最近更新在前） */
export function listDocs(projectId: string): Promise<BoardDoc[]> {
  return pb
    .collection(COL.docs)
    .getFullList<BoardDoc>({
      requestKey: null,
      filter: byProject(projectId),
      sort: "-updated",
    });
}

/**
 * 获取当前用户全部文档（跨项目，按 updated 降序），用于全局文档搜索。
 * owner 范围由访问规则保证。
 */
export function listAllDocs(): Promise<BoardDoc[]> {
  return pb
    .collection(COL.docs)
    .getFullList<BoardDoc>({ requestKey: null, sort: "-updated" });
}

// ── CRUD ─────────────────────────────────────────────────

/** 创建文档记录，返回创建后的完整记录 */
export function createDocRecord(
  data: Record<string, unknown>,
): Promise<BoardDoc> {
  return pb.collection(COL.docs).create<BoardDoc>(data);
}

/** 更新文档记录，返回更新后的完整记录 */
export function updateDocRecord(
  id: string,
  data: Record<string, unknown>,
): Promise<BoardDoc> {
  return pb.collection(COL.docs).update<BoardDoc>(id, data);
}

/** 删除文档记录 */
export function deleteDocRecord(id: string): Promise<void> {
  // PB .delete() 返回 true，包装为 void
  return pb.collection(COL.docs).delete(id).then(() => undefined);
}

// ── 实时订阅 ──────────────────────────────────────────────

/**
 * 订阅指定项目的 docs 实时变更（仅当前打开的项目 —— YAGNI）。
 * 订阅通配主题 '*'，用 project 过滤器限定范围。
 * @returns 单一 unsubscribe 函数，调用后取消订阅。
 */
export async function subscribeDocs(
  projectId: string,
  onEvent: (action: string, rec: BoardDoc) => void,
): Promise<() => void> {
  const filter = byProject(projectId);
  // PB subscribe 事件类型为 { action: string; record: BoardDoc }
  const unsub = await pb
    .collection(COL.docs)
    .subscribe<BoardDoc>("*", (e) => onEvent(e.action, e.record), { filter });

  // 返回聚合退订函数（当前仅一个订阅，保持与 board 一致的形态）
  return () => {
    void unsub();
  };
}
