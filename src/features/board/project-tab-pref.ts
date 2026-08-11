// 项目工作台「默认打开标签页」偏好：全局默认 + 每项目记住上次停留。
// 纯 localStorage，无后端/无迁移（KISS）；供 ProjectWorkspace 读写、设置页配置全局默认。
export type WorkspaceTab =
  | "overview"
  | "sessions"
  | "board"
  | "docs"
  | "activity"
  | "ai";

// 供设置页下拉：只列「始终存在」的标签页（不含仅绑定仓库才有的「提交」，
// 避免把全局默认设到一个可能不显示的标签上）。
export const WORKSPACE_TABS: { value: WorkspaceTab; label: string }[] = [
  { value: "overview", label: "概览" },
  { value: "sessions", label: "会话" },
  { value: "board", label: "看板" },
  { value: "docs", label: "文档" },
  { value: "activity", label: "活动" },
  { value: "ai", label: "AI" },
];

const DEFAULT_KEY = "keelson:proj-default-tab";
const perProjectKey = (id: string) => `keelson:proj-tab:${id}`;

// 全局兜底默认（用户可在设置页更改）；未设置时用「看板」保持既有行为。
export function getDefaultTab(): WorkspaceTab {
  try {
    const v = localStorage.getItem(DEFAULT_KEY) as WorkspaceTab | null;
    return v && WORKSPACE_TABS.some((t) => t.value === v) ? v : "board";
  } catch {
    return "board";
  }
}
export function setDefaultTab(tab: WorkspaceTab): void {
  try {
    localStorage.setItem(DEFAULT_KEY, tab);
  } catch {
    /* 隐私模式等写入失败忽略 */
  }
}

// 记住某项目上次停留的标签页
export function rememberProjectTab(id: string, tab: string): void {
  try {
    localStorage.setItem(perProjectKey(id), tab);
  } catch {
    /* 忽略 */
  }
}
function lastProjectTab(id: string): string | null {
  try {
    return localStorage.getItem(perProjectKey(id));
  } catch {
    return null;
  }
}

// 打开项目时解析初始标签页：深链 ?tab= > 该项目上次停留 > 全局默认。
export function resolveInitialTab(
  paramTab: string | null,
  projectId: string | null | undefined,
): string {
  return paramTab || (projectId && lastProjectTab(projectId)) || getDefaultTab();
}
