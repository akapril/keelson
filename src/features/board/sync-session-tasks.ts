// 会话「规划的任务」→ 看板同步（方案 A：镜像成卡片 + 状态跟随，手动触发、幂等）。
// 源：ipc.sessionTasks（Claude 的 TaskCreate/TaskUpdate 落盘状态）。
// 锚点 claude-task:<sid>:<taskId> 保证同一任务只对应一张卡；重新同步只更新状态列（进度跟随）。
import { ipc } from "@/lib/tauri/ipc";
import {
  listStates,
  listTasks,
  createRecord,
  updateRecord,
} from "@/lib/pb/board";
import { COL } from "@/lib/pb/collections";
import { currentUserId } from "@/lib/pb";
import { nextRank } from "@/store/board-rank";
import type { BoardTask, BoardState, StateCategory } from "@/types/board";
import i18n from "../../i18n";

/** 会话任务状态 → 看板状态类别。 */
function categoryOf(status: string): StateCategory {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "active";
  return "pending";
}

/** 稳定锚点：同会话同任务 id → 同一张卡（幂等，重同步只更新）。 */
export function sessionTaskAnchor(sessionId: string, taskId: string): string {
  return `claude-task:${sessionId}:${taskId}`;
}

export interface SyncResult {
  /** 会话侧规划任务总数 */
  total: number;
  /** 新建卡片数 */
  created: number;
  /** 因进度变化而移动状态列的卡片数 */
  updated: number;
}

/**
 * 把某会话规划的任务同步到指定项目的看板（手动按钮 + 自动 hook 共用）。
 * @throws 项目无状态列时抛错（提示用户先建列）。
 */
export async function syncSessionTasks(
  sessionId: string,
  provider: string,
  projectId: string,
): Promise<SyncResult> {
  const tasks = await ipc.sessionTasks(provider, sessionId);
  if (tasks.length === 0) return { total: 0, created: 0, updated: 0 };

  const [states, existing] = await Promise.all([
    listStates(projectId),
    listTasks(projectId),
  ]);
  if (states.length === 0) throw new Error(i18n.t("syncError.noStates", { ns: "board" }));

  // 某类别的目标状态列：优先同类别，退回 pending，再退回首列
  const stateOfCat = (cat: StateCategory): BoardState =>
    states.find((s) => s.category === cat) ??
    states.find((s) => s.category === "pending") ??
    states[0];

  // 现有卡片按锚点索引（幂等）
  const byAnchor = new Map(
    existing.filter((t) => t.source_anchor).map((t) => [t.source_anchor!, t]),
  );
  // 各状态列当前最大 rank（新卡追加到列末）
  const maxRank = new Map<string, number>();
  for (const t of existing) {
    const r = t.rank ?? 0;
    if (r > (maxRank.get(t.state) ?? -Infinity)) maxRank.set(t.state, r);
  }

  let created = 0;
  let updated = 0;
  for (const t of tasks) {
    const anchor = sessionTaskAnchor(sessionId, t.id);
    const target = stateOfCat(categoryOf(t.status));
    const card = byAnchor.get(anchor);
    if (card) {
      // 已有卡：仅当状态列变了（进度推进/回退）才移动
      if (card.state !== target.id) {
        await updateRecord(COL.boardTasks, card.id, { state: target.id });
        updated++;
      }
    } else {
      const rank = nextRank(maxRank.get(target.id) ?? null);
      maxRank.set(target.id, rank);
      await createRecord<BoardTask>(COL.boardTasks, {
        project: projectId,
        state: target.id,
        title: t.subject || i18n.t("taskFallbackTitle", { ns: "board", id: t.id }),
        description: t.description || undefined,
        priority: "none",
        rank,
        created_by: currentUserId(),
        source_session_id: sessionId,
        source_provider: provider,
        source_anchor: anchor,
      });
      created++;
    }
  }
  return { total: tasks.length, created, updated };
}
