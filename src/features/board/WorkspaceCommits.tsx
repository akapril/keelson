// WorkspaceCommits —— 工作台「提交」面：commit → 催生它的会话（溯源反向）。
// 列最近提交；每条按 trailer(精确) / 时间窗(可能相关) 反查会话，点击跳会话中枢。
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitCommitIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { ipc } from "@/lib/tauri/ipc";
import { useSessionsStore } from "@/store/sessions";
import type { CommitInfo } from "@/types/git";
import { commitLinkedSessions } from "@/features/sessions/commit-correlate";

/** 紧凑时间：MM-DD HH:mm（解析失败回退原串）。 */
function shortWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function WorkspaceCommits({ repoPath }: { repoPath: string }) {
  const navigate = useNavigate();
  const sessions = useSessionsStore((s) => s.sessions);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // 本仓库的会话（供反查）
  const repoSessions = sessions.filter((s) => s.project_path === repoPath);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // 近 30 天的提交，最多 100 条
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    ipc
      .gitLog(repoPath, since, null, 100)
      .then((list) => {
        if (!cancelled) setCommits(list);
      })
      .catch(() => {
        if (!cancelled) setCommits([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载提交…
      </div>
    );
  }
  if (commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        近 30 天无提交记录（或该路径非 git 仓库）。
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-1.5">
        {commits.map((c) => {
          const links = commitLinkedSessions(c, repoSessions);
          return (
            <div
              key={c.hash}
              className="rounded-lg border border-border bg-card px-3 py-2"
            >
              <div className="flex items-center gap-2 text-sm">
                <HugeiconsIcon
                  icon={GitCommitIcon}
                  strokeWidth={2}
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <code className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {c.short}
                </code>
                <span className="min-w-0 flex-1 truncate text-foreground">{c.subject}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                  {shortWhen(c.committed_at)}
                </span>
              </div>

              {/* 催生它的会话（可点跳转）；无则提示 */}
              {links.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
                  <span className="text-[10px] text-muted-foreground">
                    {links[0].kind === "trailer" ? "🎯 来自会话：" : "🕐 可能来自："}
                  </span>
                  {links.map(({ session, kind }) => (
                    <button
                      key={session.session_id}
                      type="button"
                      onClick={() => navigate(`/sessions?session=${session.session_id}`)}
                      title={`跳到会话（${kind === "trailer" ? "精确" : "可能相关"}）`}
                      className="group inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <span className="max-w-40 truncate">
                        {session.first_prompt || session.session_id.slice(0, 8)}
                      </span>
                      <HugeiconsIcon
                        icon={ArrowRight01Icon}
                        strokeWidth={2}
                        className="size-3 opacity-40 group-hover:opacity-100"
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-1 pl-6 text-[10px] text-muted-foreground/60">
                  无关联会话
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
