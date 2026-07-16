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

/**
 * 获取当前用户所有带 due_date 的任务（跨项目，用于日历聚合）。
 * owner 范围由访问规则保证；客户端再过滤出确有 due_date 的任务（date 字段空值语义稳妥）。
 */
export function listDueTasks(): Promise<BoardTask[]> {
  return pb
    .collection(COL.boardTasks)
    .getFullList<BoardTask>({ requestKey: null, sort: "due_date" })
    .then((all) => all.filter((t) => !!t.due_date));
}

/**
 * 获取由指定会话衍生的任务（source_session_id 反查，跨项目）。
 * 用于会话↔看板双向跳转：在会话预览里展示它已创建的看板任务。
 * owner 范围由访问规则保证；按创建时间倒序（新任务在前）。
 */
export function listTasksBySession(sessionId: string): Promise<BoardTask[]> {
  return pb.collection(COL.boardTasks).getFullList<BoardTask>({
    requestKey: null,
    filter: pb.filter("source_session_id = {:sid}", { sid: sessionId }),
    sort: "-created",
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

// ── 实时订阅 ──────────────────────────────────────────────

/** 订阅回调处理器：按集合分发 action + 记录 */
interface SubscribeHandlers {
  onTask: (action: string, rec: BoardTask) => void;
  onState: (action: string, rec: BoardState) => void;
  onLabel: (action: string, rec: BoardLabel) => void;
}

/**
 * 订阅指定项目的 tasks / states / labels 实时变更（仅当前打开的项目 —— YAGNI）。
 * 三个集合各自订阅通配主题 '*'，用 project 过滤器限定范围。
 * @returns 单一 unsubscribe 函数，调用后取消全部三个订阅。
 */
export async function subscribeProject(
  projectId: string,
  handlers: SubscribeHandlers,
): Promise<() => void> {
  const filter = byProject(projectId);
  // PB subscribe 事件类型为 { action: string; record: <RecordType> }
  const [unTask, unState, unLabel] = await Promise.all([
    pb.collection(COL.boardTasks).subscribe<BoardTask>(
      "*",
      (e) => handlers.onTask(e.action, e.record),
      { filter },
    ),
    pb.collection(COL.boardStates).subscribe<BoardState>(
      "*",
      (e) => handlers.onState(e.action, e.record),
      { filter },
    ),
    pb.collection(COL.boardLabels).subscribe<BoardLabel>(
      "*",
      (e) => handlers.onLabel(e.action, e.record),
      { filter },
    ),
  ]);

  // 返回聚合退订函数：一次性取消三个订阅
  return () => {
    void unTask();
    void unState();
    void unLabel();
  };
}
