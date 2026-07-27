// WorkspaceSessions —— 项目工作台「会话」标签的内容：
// 把会话中枢的「列表 + 预览」体验搬进工作台，scope 到当前项目（repo_path == project_path）。
// 复用 SessionCard（自带 建任务/恢复/收藏）与 SessionPreviewPane（自带 建任务/恢复 + 时间线）。
// 从此会话建任务时，CreateTaskFromSessionDialog 会默认命中 repo_path 匹配的本项目。
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useSessionsStore } from "@/store/sessions";
import { ipc } from "@/lib/tauri/ipc";
import type { Session } from "@/types/session";
import { SessionCard } from "@/features/sessions/SessionCard";
import { SessionPreviewPane } from "@/features/sessions/SessionPreviewPane";

/** 「新建会话」控件：在项目仓库目录就地起 claude / codex 的两个按钮。 */
function NewSessionButtons({ repoPath }: { repoPath: string }) {
  const { t } = useTranslation("board");
  const start = (provider: "claude" | "codex") => {
    const providerLabel = provider === "claude" ? "Claude" : "Codex";
    void ipc
      .startSession(provider, repoPath)
      .then(() =>
        toast.success(t("sessions.toast.startSuccess", { provider: providerLabel })),
      )
      .catch((e) => toast.error(t("sessions.toast.startError", { msg: String(e) })));
  };
  const cls =
    "rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground";
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={cls} onClick={() => start("claude")}>
        {t("sessions.newClaude")}
      </button>
      <button type="button" className={cls} onClick={() => start("codex")}>
        {t("sessions.newCodex")}
      </button>
    </div>
  );
}

export function WorkspaceSessions({ repoPath }: { repoPath: string }) {
  const { t } = useTranslation("board");
  const sessions = useSessionsStore((s) => s.sessions);
  const linked = sessions.filter((s) => s.project_path === repoPath);
  const [selected, setSelected] = useState<Session | null>(null);

  // 关联会话变化时维护选中项：无则清空；当前项已失效则回退到第一个。
  useEffect(() => {
    if (linked.length === 0) {
      if (selected) setSelected(null);
      return;
    }
    if (
      !selected ||
      !linked.some((s) => s.session_id === selected.session_id)
    ) {
      setSelected(linked[0]);
    }
    // 仅在项目路径或会话列表变化时重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, sessions]);

  // 未绑仓库 → 无法新建/关联（会话按 cwd==repo_path 关联）
  if (!repoPath) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {t("sessions.noRepo")}
      </div>
    );
  }

  if (linked.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
        <p>{t("sessions.empty")}</p>
        <p className="text-xs">{t("sessions.emptyHint")}</p>
        <NewSessionButtons repoPath={repoPath} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* 左：关联会话列表（可选中） */}
      <div className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto pr-1">
        <div className="flex shrink-0 items-center justify-between gap-2 px-0.5">
          <span className="text-xs text-muted-foreground">{t("sessions.linkedCount", { count: linked.length })}</span>
          <NewSessionButtons repoPath={repoPath} />
        </div>
        {linked.map((s) => (
          <SessionCard
            key={s.session_id}
            session={s}
            selected={selected?.session_id === s.session_id}
            onSelect={setSelected}
          />
        ))}
      </div>

      {/* 右：选中会话预览（含 建任务 / 恢复） */}
      <div className="min-w-0 flex-1 overflow-hidden">
        <SessionPreviewPane session={selected} />
      </div>
    </div>
  );
}
