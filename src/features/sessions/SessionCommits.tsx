// SessionCommits —— 会话→Commit 溯源：与本会话关联的提交（受 SessionProvenance 折叠控制）。
// 始终拉取并经 onCount 上报数量（供摘要胶囊显示）；仅 open 时渲染详情列表。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

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

export function SessionCommits({
  session,
  open,
  onCount,
}: {
  session: Session;
  open: boolean;
  onCount: (n: number) => void;
}) {
  const { t } = useTranslation("sessions");
  const [commits, setCommits] = useState<CorrelatedCommit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ipc
      .sessionCommits(session.session_id, session.provider)
      .then((list) => {
        if (cancelled) return;
        setCommits(list);
        onCount(list.length);
      })
      .catch(() => {
        if (!cancelled) {
          setCommits([]);
          onCount(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // onCount 是父级 setState 包装，排除以免刷新循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.session_id, session.provider]);

  if (!open) return null;
  if (loading) {
    return <p className="mt-2 px-1 text-xs text-muted-foreground">{t("commits.loading")}</p>;
  }
  if (commits.length === 0) {
    return <p className="mt-2 px-1 text-xs text-muted-foreground">{t("commits.empty")}</p>;
  }

  return (
    <div className="mt-2 flex max-h-52 flex-col gap-1.5 overflow-y-auto pr-1">
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
          {link_kind === "trailer" ? (
            <span
              className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
              title={t("commits.exactMatchTitle")}
            >
              {t("commits.exactMatch")}
            </span>
          ) : (
            <span
              className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              title={t("commits.likelyRelatedTitle")}
            >
              {t("commits.likelyRelated")}
            </span>
          )}
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
            {shortWhen(commit.committed_at)}
          </span>
        </div>
      ))}
    </div>
  );
}
