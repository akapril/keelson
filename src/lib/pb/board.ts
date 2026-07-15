// Board PB SDK 数据访问层 —— 唯一允许调用 pb.collection 的 board 文件。
// 组件 / Store 禁止直接调用 pb.collection；统一走此模块。
import { pb } from "../pb";
import { COL } from "./collections";
import type {
  BoardTemplate,
  BoardProject,
  BoardState,
  BoardLabel,
  BoardTask,
} from "../../types/board";

// ── 查询辅助 ──────────────────────────────────────────────
/** 按项目 ID 过滤的 PB filter 字符串 */
const byProject = (projectId: string) =>
  pb.filter("project = {:p}", { p: projectId });

// ── 列表查询 ──────────────────────────────────────────────

/** 获取所有看板模板 */
export function listTemplates(): Promise<BoardTemplate[]> {
  return pb
    .collection(COL.boardTemplates)
    .getFullList<BoardTemplate>({ requestKey: null });
}

/** 获取所有看板项目 */
export function listProjects(): Promise<BoardProject[]> {
  return pb
    .collection(COL.boardProjects)
    .getFullList<BoardProject>({ requestKey: null });
}

/** 获取指定项目的状态列（按 sort_order 升序） */
export function listStates(projectId: string): Promise<BoardState[]> {
  return pb
    .collection(COL.boardStates)
    .getFullList<BoardState>({
      requestKey: null,
      filter: byProject(projectId),
      sort: "sort_order",
    });
}

/** 获取指定项目的标签 */
export function listLabels(projectId: string): Promise<BoardLabel[]> {
  return pb
    .collection(COL.boardLabels)
    .getFullList<BoardLabel>({
      requestKey: null,
      filter: byProject(projectId),
    });
}

/** 获取指定项目的任务（按 rank 升序） */
export function listTasks(projectId: string): Promise<BoardTask[]> {
  return pb
    .collection(COL.boardTasks)
    .getFullList<BoardTask>({
      requestKey: null,
      filter: byProject(projectId),
      sort: "rank",
    });
}

// ── 通用 CRUD ─────────────────────────────────────────────

/** 创建记录，返回创建后的完整记录 */
export function createRecord<T>(
  coll: string,
  data: Record<string, unknown>,
): Promise<T> {
  return pb.collection(coll).create<T>(data);
}

/** 更新记录，返回更新后的完整记录 */
export function updateRecord<T>(
  coll: string,
  id: string,
  data: Record<string, unknown>,
): Promise<T> {
  return pb.collection(coll).update<T>(id, data);
}

/** 删除记录 */
export function deleteRecord(coll: string, id: string): Promise<void> {
  // PB .delete() 返回 true，包装为 void
  return pb.collection(coll).delete(id).then(() => undefined);
}
