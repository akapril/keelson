// commit→会话 反向关联（工作台「提交」面用）。
// 规则与 Rust commands/git.rs 的 correlate_session_commits 对齐：
// trailer 精确优先；否则 committed_at ∈ [session.created, session.updated + grace] → 可能相关。
import type { CommitInfo, LinkKind } from "@/types/git";
import type { Session } from "@/types/session";

/** 会话→提交关联的默认宽限（4h），与后端 COMMIT_GRACE_SECS 一致。 */
export const COMMIT_GRACE_SECS = 14400;

export interface CommitSessionLink {
  session: Session;
  kind: LinkKind;
}

/**
 * 求某提交关联到的会话：
 * - commit 带 trailer → 只认精确：命中已加载会话则返回该会话(trailer)，未命中(如会话未加载/跨机)
 *   返回空——**不降级为时间窗**，避免把精确信号误显示成"可能相关"。
 * - 无 trailer → 按时间窗返回所有 committed_at 落在其 [created, updated+grace] 内的会话（time）。
 * 时间解析失败 → 空。sessions 应已按仓库过滤。
 */
export function commitLinkedSessions(
  commit: CommitInfo,
  sessions: Session[],
  graceSecs: number = COMMIT_GRACE_SECS,
): CommitSessionLink[] {
  if (commit.rework_session) {
    const hit = sessions.find((s) => s.session_id === commit.rework_session);
    return hit ? [{ session: hit, kind: "trailer" }] : [];
  }
  const t = new Date(commit.committed_at).getTime();
  if (Number.isNaN(t)) return [];
  const graceMs = graceSecs * 1000;
  return sessions
    .filter((s) => {
      const c = new Date(s.created_at).getTime();
      const u = new Date(s.updated_at).getTime();
      return !Number.isNaN(c) && !Number.isNaN(u) && t >= c && t <= u + graceMs;
    })
    .map((s) => ({ session: s, kind: "time" as const }));
}
