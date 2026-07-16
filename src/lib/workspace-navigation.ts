// 工作区记录深链接：?open=<id> —— 移植自 workavera（Apache-2.0）。
// 用同一个 query 参数在各区块（board 等）定位并打开某条记录（项目/任务）。
export const OPEN_RECORD_PARAM = "open";

/** 构造形如 "/board?open=<id>" 的 URL。 */
export function workspaceRecordUrl(section: string, recordId: string): string {
  const params = new URLSearchParams({ [OPEN_RECORD_PARAM]: recordId.trim() });
  return `/${section}?${params.toString()}`;
}

/** 从 URLSearchParams 读取待打开的记录 id（无则空串）。 */
export function requestedRecordId(searchParams: URLSearchParams): string {
  return searchParams.get(OPEN_RECORD_PARAM)?.trim() ?? "";
}
