// utils.ts — Spotlight 纯函数辅助（可单独测试）
import type { Session } from "../../types/session";
import type { BoardTask } from "../../types/board";
import type { BoardDoc } from "../../types/docs";
import type { BoardProject } from "../../types/board";
import type { Memory } from "../../types/memory";
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

/** 项目 → 导航候选：Enter 打开该项目工作台总览。 */
export function projectToItem(project: BoardProject): NavSpotlightItem {
  return {
    kind: "project",
    label: project.name,
    path: workspaceRecordUrl("board", project.id, { tab: "overview" }),
  };
}

/** 记忆正文首行摘要（最多 60 字符）作候选 label。 */
export function memoryLabel(memory: Memory): string {
  const firstLine = (memory.content || "").split("\n")[0].trim();
  return firstLine.slice(0, 60) + (firstLine.length > 60 ? "…" : "");
}

/** 记忆 → 导航候选：Enter 打开记忆账本页并定位该条（?open=<id>）。 */
export function memoryToItem(memory: Memory): NavSpotlightItem {
  return { kind: "memory", label: memoryLabel(memory), path: `/memory?open=${memory.id}` };
}

/** 按项目名过滤（忽略大小写）；空查询返回空（空态由 buildItems 决定）。 */
export function filterProjects(projects: BoardProject[], query: string): BoardProject[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return projects.filter((p) => (p.name || "").toLowerCase().includes(q));
}

/** 按记忆正文过滤（忽略大小写）；空查询返回空。 */
export function filterMemories(memories: Memory[], query: string): Memory[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return memories.filter((m) => (m.content || "").toLowerCase().includes(q));
}

/** 按标题关键词过滤（忽略大小写）；空查询返回空。 */
export function filterByTitle<T extends { title: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return items.filter((it) => (it.title || "").toLowerCase().includes(q));
}

/** Spotlight 候选数据源集合（挂载时预取，客户端过滤）。 */
export interface SpotlightData {
  sessions: Session[];
  projects: BoardProject[];
  docs: BoardDoc[];
  tasks: BoardTask[];
  memories: Memory[];
}

/** 类别内空查询时最多列出的条数（防极端刷屏）。 */
const CATEGORY_CAP = 200;

/**
 * 由查询与类别构建候选项：
 * - all + 空 query → 最近会话（沿用现状，不混他类）。
 * - all + query → 会话+项目+文档+任务+记忆 各截断 PER_KIND_LIMIT（会话在前）。
 * - 具体类别 + 空 query → 该类全部（CATEGORY_CAP 上限）。
 * - 具体类别 + query → 该类过滤。
 */
export function buildItems(
  query: string,
  category: SpotlightCategory,
  data: SpotlightData,
): SpotlightItem[] {
  const q = query.trim();
  if (category === "all") {
    if (!q) return recentSessions(data.sessions, 20).map(sessionToItem);
    return [
      ...filterSessions(data.sessions, q).slice(0, PER_KIND_LIMIT).map(sessionToItem),
      ...filterProjects(data.projects, q).slice(0, PER_KIND_LIMIT).map(projectToItem),
      ...filterByTitle(data.docs, q).slice(0, PER_KIND_LIMIT).map(docToItem),
      ...filterByTitle(data.tasks, q).slice(0, PER_KIND_LIMIT).map(taskToItem),
      ...filterMemories(data.memories, q).slice(0, PER_KIND_LIMIT).map(memoryToItem),
    ];
  }
  switch (category) {
    case "session":
      return (q ? filterSessions(data.sessions, q) : recentSessions(data.sessions, CATEGORY_CAP))
        .slice(0, CATEGORY_CAP)
        .map(sessionToItem);
    case "project":
      return (q ? filterProjects(data.projects, q) : data.projects.slice(0, CATEGORY_CAP))
        .slice(0, CATEGORY_CAP)
        .map(projectToItem);
    case "doc":
      return (q ? filterByTitle(data.docs, q) : data.docs.slice(0, CATEGORY_CAP))
        .slice(0, CATEGORY_CAP)
        .map(docToItem);
    case "task":
      return (q ? filterByTitle(data.tasks, q) : data.tasks.slice(0, CATEGORY_CAP))
        .slice(0, CATEGORY_CAP)
        .map(taskToItem);
    case "memory":
      return (q ? filterMemories(data.memories, q) : data.memories.slice(0, CATEGORY_CAP))
        .slice(0, CATEGORY_CAP)
        .map(memoryToItem);
  }
}
