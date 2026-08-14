// utils.ts — Spotlight 纯函数辅助（可单独测试）
import type { Session } from "../../types/session";
import type { BoardTask } from "../../types/board";
import type { BoardDoc } from "../../types/docs";
import type {
  SpotlightItem,
  SessionSpotlightItem,
  NavSpotlightItem,
} from "../../store/spotlight";
import type { SpotlightCategory } from "../../store/spotlight";
import { workspaceRecordUrl } from "../../lib/workspace-navigation";
import i18n from "../../i18n";

/** 每类候选在搜索结果里的上限（避免某类刷屏）。 */
const PER_KIND_LIMIT = 8;

/** 各类别的输入前缀（all 无前缀）。改前缀只改此表。 */
export const PREFIX_BY_CATEGORY: Record<SpotlightCategory, string> = {
  all: "",
  session: "s ",
  project: "p ",
  doc: "d ",
  task: "t ",
  memory: "m ",
};

/** 解析输入框原始文本 → { 类别, 纯过滤词 }。命中 s/p/d/t/m 前缀则归对应类别，否则 all。 */
export function parsePrefix(raw: string): { category: SpotlightCategory; query: string } {
  const prefixed: SpotlightCategory[] = ["session", "project", "doc", "task", "memory"];
  for (const cat of prefixed) {
    const p = PREFIX_BY_CATEGORY[cat];
    if (raw.startsWith(p)) return { category: cat, query: raw.slice(p.length) };
  }
  return { category: "all", query: raw };
}

/** 由类别 + 纯过滤词拼回输入框显示值（受控 input 用）。 */
export function formatInput(category: SpotlightCategory, query: string): string {
  return PREFIX_BY_CATEGORY[category] + query;
}

/**
 * 将会话列表按 updated_at 降序排列，取前 N 条（最近会话）
 * 用于 query 为空时显示最近会话
 */
export function recentSessions(sessions: Session[], n: number): Session[] {
  return [...sessions]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, n);
}

/**
 * 按关键词过滤会话
 * 匹配范围：project_name、first_prompt、last_prompt、project_path（均忽略大小写）
 */
export function filterSessions(sessions: Session[], query: string): Session[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((s) => {
    return (
      s.project_name.toLowerCase().includes(q) ||
      s.first_prompt.toLowerCase().includes(q) ||
      s.last_prompt.toLowerCase().includes(q) ||
      s.project_path.toLowerCase().includes(q)
    );
  });
}

/**
 * 将 Session 转为 SpotlightItem（会话变体）
 * label 格式：project_name — first_prompt 摘要（最多 60 字符）
 */
export function sessionToItem(session: Session): SessionSpotlightItem {
  const summary = session.first_prompt.slice(0, 60) + (session.first_prompt.length > 60 ? "…" : "");
  const label = `${session.project_name} — ${summary}`;
  return { kind: "session", session, label };
}

/** 任务 → 导航候选：Enter 打开该任务所在项目的看板。 */
export function taskToItem(task: BoardTask): NavSpotlightItem {
  return {
    kind: "task",
    label: task.title,
    path: workspaceRecordUrl("board", task.project, { tab: "board" }),
  };
}

/** 文档 → 导航候选：Enter 打开该文档所在项目的文档面并定位。 */
export function docToItem(doc: BoardDoc): NavSpotlightItem {
  return {
    kind: "doc",
    label: doc.title || i18n.t("commandPalette.unnamedDoc", { ns: "shell" }),
    path: workspaceRecordUrl("board", doc.projects[0] ?? "", { tab: "docs", doc: doc.id }),
  };
}

/** 按标题关键词过滤（忽略大小写）；空查询返回空。 */
export function filterByTitle<T extends { title: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return items.filter((it) => (it.title || "").toLowerCase().includes(q));
}

/**
 * 由查询构建候选项列表：
 * - query 为空 → 最近会话（沿用原行为，不混入任务/文档，保持"最近会话"心智）。
 * - query 非空 → 会话 + 任务 + 文档 各自过滤后合并（每类截断 PER_KIND_LIMIT，会话在前）。
 */
export function buildItems(
  query: string,
  sessions: Session[],
  tasks: BoardTask[],
  docs: BoardDoc[],
  recentN: number,
): SpotlightItem[] {
  if (!query.trim()) {
    return recentSessions(sessions, recentN).map(sessionToItem);
  }
  const sItems = filterSessions(sessions, query).slice(0, PER_KIND_LIMIT).map(sessionToItem);
  const tItems = filterByTitle(tasks, query).slice(0, PER_KIND_LIMIT).map(taskToItem);
  const dItems = filterByTitle(docs, query).slice(0, PER_KIND_LIMIT).map(docToItem);
  return [...sItems, ...tItems, ...dItems];
}
