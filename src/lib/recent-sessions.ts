// 收藏行「继续会话」用：取某项目最近的若干会话。
// 纯函数（无副作用、不碰 store/ipc），便于单测。
import type { Session } from "@/types/session";

/**
 * 取指定项目目录下最近的会话，按更新时间倒序，最多 limit 条。
 * @param sessions 全量会话缓存
 * @param repoPath 项目仓库目录（对应 session.project_path）；为空则返回空数组
 * @param limit 返回上限（默认 5）
 * updated_at 为 RFC3339 字符串，同格式可直接字典序比较（无需 Date 解析）。
 */
export function recentSessionsOf(
  sessions: Session[],
  repoPath: string | undefined,
  limit = 5,
): Session[] {
  if (!repoPath) return [];
  return sessions
    .filter((s) => s.project_path === repoPath)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
    .slice(0, limit);
}
