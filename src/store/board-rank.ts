// 拖拽排序的浮点 rank 计算（lexorank 数值变体），纯函数便于测试。

/** 新建任务的 rank：某列当前最大 rank + 1024（空列为 1024）。 */
export function nextRank(maxRank: number | null): number {
  return maxRank == null ? 1024 : maxRank + 1024;
}

/** 拖拽插入位置的 rank：取前后邻居的中值/外扩。 */
export function rankBetween(before?: number, after?: number): number {
  if (before != null && after != null) return (before + after) / 2;
  if (before != null) return before + 1024;
  if (after != null) return after - 1024;
  return 1024;
}

/** 状态列重排时的整数归一化 sort_order：[1024, 2048, ...]。 */
export function normalizeSortOrders(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * 1024);
}
