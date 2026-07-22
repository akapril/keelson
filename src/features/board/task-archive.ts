// 看板已完成任务的归档逻辑（纯函数 + 阈值偏好）。
// 归档而非删除：保留「会话→任务→提交」溯源；自动归档=完成超过 N 天的任务自动归档。
import type { BoardTask, BoardState } from "@/types/board";

const DAYS_KEY = "rework:board-auto-archive-days";
export const DEFAULT_AUTO_ARCHIVE_DAYS = 7;

/** 读取自动归档阈值（天）；0 表示关闭。未设置用默认 7。 */
export function getAutoArchiveDays(): number {
  try {
    const v = localStorage.getItem(DAYS_KEY);
    if (v === null) return DEFAULT_AUTO_ARCHIVE_DAYS;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_AUTO_ARCHIVE_DAYS;
  } catch {
    return DEFAULT_AUTO_ARCHIVE_DAYS;
  }
}
export function setAutoArchiveDays(days: number): void {
  try {
    localStorage.setItem(DAYS_KEY, String(Math.max(0, Math.floor(days))));
  } catch {
    /* 隐私模式等忽略 */
  }
}

/**
 * 计算应自动归档的任务 id：完成类别、未归档、且 updated 距 now 超过 thresholdDays。
 * thresholdDays<=0 视为关闭，返回空。用 updated 作为「进入完成」的近似时间戳。
 * 纯函数、可测（now 由调用方传入）。
 */
export function tasksToAutoArchive(
  tasks: BoardTask[],
  states: BoardState[],
  thresholdDays: number,
  now: number,
): string[] {
  if (thresholdDays <= 0) return [];
  const completed = new Set(
    states.filter((s) => s.category === "completed").map((s) => s.id),
  );
  const cutoff = now - thresholdDays * 86_400_000;
  return tasks
    .filter((t) => !t.archived && completed.has(t.state))
    .filter((t) => {
      const ts = Date.parse(t.updated);
      return Number.isFinite(ts) && ts < cutoff;
    })
    .map((t) => t.id);
}

/** 某状态列中可归档的（未归档）任务 id——用于「一键归档本列已完成」。 */
export function archivableInState(tasks: BoardTask[], stateId: string): string[] {
  return tasks.filter((t) => t.state === stateId && !t.archived).map((t) => t.id);
}
