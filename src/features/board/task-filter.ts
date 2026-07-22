// 看板任务筛选（纯函数，可测）：文本 + 标签 + 优先级。
import type { BoardTask, TaskPriority } from "@/types/board";

export interface TaskFilter {
  /** 文本：匹配标题或描述 */
  query: string;
  /** 标签 id 列表；空=不按标签筛。命中任一即通过（OR）。 */
  labels: string[];
  /** 优先级；null=不按优先级筛。 */
  priority: TaskPriority | null;
}

export const EMPTY_FILTER: TaskFilter = { query: "", labels: [], priority: null };

/** 是否有任一筛选生效（用于显示「清除」）。 */
export function isFilterActive(f: TaskFilter): boolean {
  return f.query.trim() !== "" || f.labels.length > 0 || f.priority !== null;
}

/** 单个任务是否匹配筛选（各条件 AND）。 */
export function taskMatchesFilter(t: BoardTask, f: TaskFilter): boolean {
  const q = f.query.trim().toLowerCase();
  if (
    q &&
    !(
      (t.title || "").toLowerCase().includes(q) ||
      (t.description || "").toLowerCase().includes(q)
    )
  ) {
    return false;
  }
  if (f.labels.length > 0) {
    const tl = t.labels ?? [];
    if (!f.labels.some((id) => tl.includes(id))) return false;
  }
  if (f.priority && t.priority !== f.priority) return false;
  return true;
}
