// 区分看板任务来源 + 「注入 CLI」选择集（方案 A：选择性注入）。
// - CLI 同步来的任务：source_anchor 以 claude-task: 开头（sync-session-tasks 打的锚点）。
//   它们本就出生在 CLI，不该再注入回 CLI（避免循环/双重计数）。
// - 自建任务：其余（手建 / 计划导入）。仅自建可加入注入集。
import type { BoardTask } from "@/types/board";

/** 是否为 CLI（Claude/Codex）同步来的任务。 */
export function isCliSynced(t: Pick<BoardTask, "source_anchor">): boolean {
  return !!t.source_anchor?.startsWith("claude-task:");
}

// ── 注入集（按项目隔离，存 localStorage） ──────────────────
const keyOf = (projectId: string) => `keelson-cli-inject:${projectId}`;

function load(projectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(keyOf(projectId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function save(projectId: string, set: Set<string>): void {
  try {
    localStorage.setItem(keyOf(projectId), JSON.stringify([...set]));
  } catch {
    /* 忽略写入失败 */
  }
}

/** 读取某项目的注入集 id。 */
export function getInjectSet(projectId: string): Set<string> {
  return load(projectId);
}

/** 切换某任务在注入集中的存在；返回切换后是否已在集内。 */
export function toggleInject(projectId: string, taskId: string): boolean {
  const set = load(projectId);
  const nowIn = !set.has(taskId);
  if (nowIn) set.add(taskId);
  else set.delete(taskId);
  save(projectId, set);
  return nowIn;
}
