// utils.ts — Spotlight 纯函数辅助（可单独测试）
import type { Session } from "../../types/session";
import type { SpotlightItem } from "../../store/spotlight";

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
 * 将 Session 转为 SpotlightItem
 * label 格式：project_name — first_prompt 摘要（最多 60 字符）
 */
export function sessionToItem(session: Session): SpotlightItem {
  const summary = session.first_prompt.slice(0, 60) + (session.first_prompt.length > 60 ? "…" : "");
  const label = `${session.project_name} — ${summary}`;
  return { session, label };
}
