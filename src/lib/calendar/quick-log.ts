// 快速记录解析 —— 从「刚才做了什么」文本里识别 @项目 标记，关联到看板项目并从标题剥离该 token。
// 纯函数（无副作用），供日历快录条与命令面板「记一笔」共用；配 vitest。
import type { BoardProject } from "@/types/board";

/** 快录事件默认色（indigo）——日历快录条与命令面板「记一笔」共用，避免各写各的漂移。 */
export const DEFAULT_EVENT_COLOR = "#6366f1";

export interface ParsedQuickLog {
  /** 剥离 @token 后的事件标题 */
  title: string;
  /** 关联到的项目 id（未匹配到则空串） */
  project: string;
}

/**
 * 解析快录文本里的 `@项目` 标记：
 * - 取第一个 `@` 后到下一个空白为止的 token（`\S` 兼容中文项目名）。
 * - 与项目名不区分大小写匹配：完全相等优先，其次前缀匹配（多个前缀命中取名字最短者，最贴近意图）。
 * - 匹配成功：关联该项目 id，并从标题剥离 `@token`；剥完为空则回退用项目名当标题。
 * - 未匹配到任何项目：原样保留（含 `@`），绝不乱关联。
 */
export function parseQuickLog(text: string, projects: BoardProject[]): ParsedQuickLog {
  const raw = text.trim();
  const m = raw.match(/@(\S+)/);
  if (!m) return { title: raw, project: "" };

  const token = m[1].toLowerCase();
  const exact = projects.find((p) => p.name.toLowerCase() === token);
  // 前缀候选里取名字最短的（最精确的匹配意图）
  const prefixes = projects
    .filter((p) => p.name.toLowerCase().startsWith(token))
    .sort((a, b) => a.name.length - b.name.length);
  const matched = exact ?? prefixes[0];
  if (!matched) return { title: raw, project: "" };

  const title = raw.replace(m[0], "").replace(/\s+/g, " ").trim();
  return { title: title || matched.name, project: matched.id };
}
