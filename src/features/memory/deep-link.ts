// 记忆账本深链定位：从可见列表中找 ?open=<id> 对应下标（供滚动/高亮）。
export function indexOfMemory(list: { id: string }[], id: string | null): number {
  if (!id) return -1;
  return list.findIndex((m) => m.id === id);
}
