// WorkspaceCommits —— 工作台「提交」面：commit → 催生它的会话（溯源反向）。
// 列最近提交；每条按 trailer(精确) / 时间窗(可能相关) 反查会话，点击跳会话中枢。
import { useEffect, useMemo, useState } from "react";
import { Virtualizer } from "virtua";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitCommitIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { ipc } from "@/lib/tauri/ipc";
import { Button } from "@/components/ui/button";
import { useSessionsStore } from "@/store/sessions";
import type { CommitInfo, HookStatus } from "@/types/git";
import { commitLinkedSessions } from "@/features/sessions/commit-correlate";

/** 会话溯源钩子状态条：启用后新提交自动带 Rework-Session trailer（精确关联）。 */
function HookBar({ repoPath }: { repoPath: string }) {
  const { t } = useTranslation("board");
  const [status, setStatus] = useState<HookStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    ipc
      .sessionHookStatus(repoPath)
      .then(setStatus)
      .catch(() => setStatus(null));
  };
  useEffect(refresh, [repoPath]);

  const toggle = async () => {
    if (!status || busy) return;
    setBusy(true);
    try {
      if (status.installed) {
        await ipc.uninstallSessionTrailerHook(repoPath);
        toast.success(t("commits.hook.toast.disabled"));
      } else {
        await ipc.installSessionTrailerHook(repoPath);
        toast.success(t("commits.hook.toast.enabled"));
      }
      refresh();
    } catch (e) {
      toast.error(t("commits.hook.toast.error", { msg: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs">
      {status.installed ? (
        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 font-medium text-primary">
          {t("commits.hook.enabled")}
        </span>
      ) : (
        <span className="text-muted-foreground">
          {t("commits.hook.disabled")}
        </span>
      )}
      {status.foreign_hook_present && !status.installed && (
        <span className="text-muted-foreground/70">{t("commits.hook.foreignHook")}</span>
      )}
      <Button variant="ghost" size="xs" className="ml-auto" disabled={busy} onClick={() => void toggle()}>
        {status.installed ? t("commits.hook.disableBtn") : t("commits.hook.enableBtn")}
      </Button>
    </div>
  );
}

/** 紧凑时间：MM-DD HH:mm（解析失败回退原串）。 */
function shortWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function WorkspaceCommits({ repoPath }: { repoPath: string }) {
  const { t } = useTranslation("board");
  const navigate = useNavigate();
  const sessions = useSessionsStore((s) => s.sessions);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // 本仓库的会话（供反查）——memo 避免每次渲染重算
  const repoSessions = useMemo(
    () => sessions.filter((s) => s.project_path === repoPath),
    [sessions, repoPath],
  );

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <HookBar repoPath={repoPath} />
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("commits.loading")}
        </div>
      ) : commits.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("commits.empty")}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Virtualizer>
            {commits.map((c) => {
          const links = commitLinkedSessions(c, repoSessions);
          return (
            <div
              key={c.hash}
              className="mb-1.5 rounded-lg border border-border bg-card px-3 py-2"
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
                    {links[0].kind === "trailer" ? t("commits.trailerFrom") : t("commits.maybeFrom")}
                  </span>
                  {links.map(({ session, kind }) => (
                    <button
                      key={session.session_id}
                      type="button"
                      onClick={() => navigate(`/sessions?session=${session.session_id}`)}
                      title={t("commits.sessionTitle", { kind: kind === "trailer" ? t("commits.kindTrailer") : t("commits.kindWindow") })}
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
                  {t("commits.noLinked")}
                </div>
              )}
            </div>
          );
        })}
          </Virtualizer>
        </div>
      )}
    </div>
  );
}
