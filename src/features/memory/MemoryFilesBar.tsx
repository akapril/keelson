// MemoryFilesBar —— 项目工作台：把「全局 ∪ 本项目」记忆同步进 <repo>/CLAUDE.md、AGENTS.md 受管块。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";
import { Button } from "@/components/ui/button";
import { listMemories } from "@/lib/pb/memory";
import type { MemFilesStatus } from "@/types/memory";

export function MemoryFilesBar({ repoPath, projectId }: { repoPath: string; projectId: string }) {
  const { t } = useTranslation("memory");
  const [status, setStatus] = useState<MemFilesStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    ipc.memoryProjectFilesStatus(repoPath).then(setStatus).catch(() => setStatus(null));
  };
  useEffect(refresh, [repoPath]);

  const sync = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const all = await listMemories();
      const mems = all
        .filter(
          (m) =>
            !m.superseded_by &&
            m.status !== "pending" && // 待审记忆未采纳，不注入 CLAUDE.md（否则绕过审核门禁）
            (m.scope === "global" || (m.scope === "project" && m.project === projectId)),
        )
        .map((m) => ({ content: m.content, kind: m.kind, scope: m.scope }));
      const written = await ipc.memoryWriteProjectFiles(repoPath, mems);
      toast.success(
        mems.length > 0
          ? t("filesBar.toastSynced", { count: mems.length, files: written.length })
          : t("filesBar.toastEmpty"),
      );
      refresh();
    } catch (e) {
      toast.error(t("filesBar.toastError", { msg: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const synced = status && (status.claude_md || status.agents_md);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs">
      {synced ? (
        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 font-medium text-primary">
          {t("filesBar.syncedLabel")}
        </span>
      ) : (
        <span className="text-muted-foreground">
          {t("filesBar.unsyncedDesc")}
        </span>
      )}
      <Button variant="ghost" size="xs" className="ml-auto" disabled={busy} onClick={() => void sync()}>
        {busy ? t("filesBar.busyButton") : synced ? t("filesBar.resyncButton") : t("filesBar.syncButton")}
      </Button>
    </div>
  );
}
