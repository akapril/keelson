// SessionProvenance —— 会话溯源摘要条：把「关联任务 / 提交 / 改动文件」收成一行胶囊，
// 默认全折叠，点某个胶囊展开对应详情。把纵向空间还给会话消息(SessionChat)。
// 三个子组件始终挂载(拉数据+上报数量)，仅 open 的那个渲染详情。
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  GitCommitIcon,
  File01Icon,
  DashboardSquare02Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

import { SessionCommits } from "./SessionCommits";
import { SessionFileChanges } from "./SessionFileChanges";
import { SessionLinkedTasks } from "./SessionLinkedTasks";
import type { Session } from "@/types/session";

type Key = "tasks" | "commits" | "files";

export function SessionProvenance({
  session,
  tasksRefreshKey,
}: {
  session: Session;
  tasksRefreshKey?: number;
}) {
  const { t } = useTranslation("sessions");
  const [counts, setCounts] = useState<Record<Key, number>>({ tasks: 0, commits: 0, files: 0 });
  const [open, setOpen] = useState<Key | null>(null);
  // 稳定的计数上报（仅在值变化时 setState，避免多余渲染）
  const mk = (k: Key) => (n: number) =>
    setCounts((c) => (c[k] === n ? c : { ...c, [k]: n }));

  const chips: { key: Key; label: string; icon: IconSvgElement; n: number }[] = [
    { key: "commits", label: t("provenance.commits"), icon: GitCommitIcon, n: counts.commits },
    { key: "files", label: t("provenance.files"), icon: File01Icon, n: counts.files },
    { key: "tasks", label: t("provenance.tasks"), icon: DashboardSquare02Icon, n: counts.tasks },
  ];
  const shown = chips.filter((c) => c.n > 0);

  return (
    <div className="shrink-0">
      {shown.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
          {shown.map((c) => {
            const active = open === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setOpen(active ? null : c.key)}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                title={active ? t("provenance.collapse") : t("provenance.expand")}
              >
                <HugeiconsIcon icon={c.icon} strokeWidth={2} className="size-3.5" />
                {c.label}
                <span className="tabular-nums">{c.n}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 详情：三者始终挂载(拉数据+上报数量)，只有 open 的渲染内容 */}
      <SessionCommits session={session} open={open === "commits"} onCount={mk("commits")} />
      <SessionFileChanges session={session} open={open === "files"} onCount={mk("files")} />
      <SessionLinkedTasks
        sessionId={session.session_id}
        refreshKey={tasksRefreshKey}
        open={open === "tasks"}
        onCount={mk("tasks")}
      />
    </div>
  );
}
