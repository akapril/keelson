// 列表视图分组：按 state.sort_order 排组，组内按 rank 升序，默认排除已归档。
// 返回有序数组（区别于 store 的 groupTasksByState 返回 Record）；纯函数、可测、不 import store。
import type { BoardTask, BoardState } from "@/types/board";

export function orderedTaskGroups(
  tasks: BoardTask[],
  states: BoardState[],
  showArchived = false,
): Array<{ state: BoardState; tasks: BoardTask[] }> {
  const sorted = [...states].sort((a, b) => a.sort_order - b.sort_order);
  return sorted.map((state) => ({
    state,
    tasks: tasks
      .filter((t) => t.state === state.id && (showArchived || !t.archived))
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
  }));
}
