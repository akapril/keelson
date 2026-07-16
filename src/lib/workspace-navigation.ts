// 工作区记录深链接：?open=<id> —— 移植自 workavera（Apache-2.0）。
// 用同一个 query 参数在各区块（board 等）定位并打开某条记录（项目/任务）。
export const OPEN_RECORD_PARAM = "open";
/** 打开工作台后定位到的标签页（overview/sessions/board/docs/ai）。 */
export const OPEN_TAB_PARAM = "tab";
/** 打开「文档」标签后定位到的具体文档 id。 */
export const OPEN_DOC_PARAM = "doc";

/**
 * 构造工作区深链接 URL，如 "/board?open=<id>&tab=docs&doc=<docId>"。
 * @param opts.tab 打开后定位的标签页；opts.doc 文档标签内定位的文档 id。
 */
export function workspaceRecordUrl(
  section: string,
  recordId: string,
  opts?: { tab?: string; doc?: string },
): string {
  const params = new URLSearchParams({ [OPEN_RECORD_PARAM]: recordId.trim() });
  if (opts?.tab) params.set(OPEN_TAB_PARAM, opts.tab);
  if (opts?.doc) params.set(OPEN_DOC_PARAM, opts.doc);
  return `/${section}?${params.toString()}`;
}

/** 从 URLSearchParams 读取待打开的记录 id（无则空串）。 */
export function requestedRecordId(searchParams: URLSearchParams): string {
  return searchParams.get(OPEN_RECORD_PARAM)?.trim() ?? "";
}
