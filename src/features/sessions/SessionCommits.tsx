// SessionCommits —— 会话→Commit 溯源：展示与本会话关联的提交。
// 关联判据在 Rust 单点（session_commits 命令）：trailer 精确 / 时间窗可能相关。
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitCommitIcon } from "@hugeicons/core-free-icons";

import { ipc } from "@/lib/tauri/ipc";
import type { CorrelatedCommit } from "@/types/git";
import type { Session } from "@/types/session";

/** 紧凑时间：MM-DD HH:mm（解析失败回退原串）。 */
function shortWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 会话期间/关联的提交列表。
 * - 无关联提交（或非 git 仓库）→ 不渲染（避免占位噪声）。
 * - 每项标注关联方式：🎯 精确（commit 带 Rework-Session trailer）/ 🕐 可能相关（时间窗）。
 */
export function SessionCommits({ session }: { session: Session }) {
  const [commits, setCommits] = useState<CorrelatedCommit[]>([]);

  useEffect(() => {
    let cancelled = false;
    ipc
      .sessionCommits(session.session_id, session.provider)
      .then((list) => {
        if (!cancelled) setCommits(list);
      })
      .catch(() => {
        // 非仓库 / git 失败不阻断预览；静默留空
        if (!cancelled) setCommits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [session.session_id, session.provider]);

  if (commits.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-border pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <HugeiconsIcon icon={GitCommitIcon} strokeWidth={2} className="size-3.5" />
        此会话期间的提交（{commits.length}）
      </div>
      {/* 限高 + 内部滚动：提交可能很多，避免撑高把下方会话消息(flex-1)挤没 */}
      <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto pr-1">
        {commits.map(({ commit, link_kind }) => (
          <div
            key={commit.hash}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
            title={`${commit.subject}\n${commit.author} · ${commit.committed_at}`}
          >
            <code className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
              {commit.short}
            </code>
            <span className="min-w-0 flex-1 truncate text-foreground">{commit.subject}</span>
            {/* 关联方式徽章：精确(trailer) vs 可能相关(时间窗) */}
            {link_kind === "trailer" ? (
              <span
                className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                title="commit 带 Rework-Session trailer，精确关联"
              >
                🎯 精确
              </span>
            ) : (
              <span
                className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                title="按提交时间落在会话时段内推断，可能相关"
              >
                🕐 可能相关
              </span>
            )}
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
              {shortWhen(commit.committed_at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
