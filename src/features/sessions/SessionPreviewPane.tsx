import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Session } from "../../types/session";
import { useSessionMetaStore } from "../../store/session-meta";
import { listProjects } from "../../lib/pb/board";
import { syncSessionTasks } from "../board/sync-session-tasks";
import { Textarea } from "@/components/ui/textarea";
import { RestoreDialog } from "./RestoreDialog";
import { SessionProvenance } from "./SessionProvenance";
import { SessionChat } from "./SessionChat";
import { CreateTaskFromSessionDialog } from "../board/CreateTaskFromSessionDialog";
import { DistillDialog } from "../chemistry/DistillDialog";
import { MemoryReviewDialog } from "../memory/MemoryReviewDialog";

/** 会话备注编辑器（存 session_notes，跟随配置后端；自动保存）。 */
function SessionNoteEditor({ sessionId }: { sessionId: string }) {
  const { t: ts } = useTranslation("sessions");
  const notes = useSessionMetaStore((s) => s.notes);
  const setNote = useSessionMetaStore((s) => s.setNote);
  const [text, setText] = useState("");

  // 切换会话时载入已存备注
  useEffect(() => {
    setText(notes.get(sessionId) ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 防抖自动保存（与已存值不同才写）
  useEffect(() => {
    const original = notes.get(sessionId) ?? "";
    if (text === original) return;
    const timer = setTimeout(
      () =>
        void setNote(sessionId, text).catch((e) =>
          toast.error(ts("preview.toast.saveNoteError", { msg: String(e) })),
        ),
      800,
    );
    return () => clearTimeout(timer);
  }, [text, sessionId, notes, setNote]);

  return (
    <Textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder={ts("preview.notePlaceholder")}
      rows={1}
      className="min-h-9 shrink-0 resize-none text-sm"
    />
  );
}

interface SessionPreviewPaneProps {
  /** 当前选中的会话；为 null 时展示空状态 */
  session: Session | null;
}

/**
 * 会话预览面板（右侧分栏）—— codex-gui 聊天视图：
 * 顶部会话信息 + 操作（恢复 / 建任务 / AI 提炼），下方内联聊天（历史气泡 + 底部续聊）。
 */
export function SessionPreviewPane({ session }: SessionPreviewPaneProps) {
  const { t } = useTranslation("sessions");
  const [restoreTarget, setRestoreTarget] = useState<Session | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [linkedRefresh, setLinkedRefresh] = useState(0);
  const [distillOpen, setDistillOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // 同步会话「规划的任务」到其关联项目的看板（按 repo_path 匹配项目）
  const syncTasks = async (s: Session) => {
    if (syncing) return;
    setSyncing(true);
    try {
      const projects = await listProjects();
      const proj = projects.find(
        (p) => p.repo_path && p.repo_path === s.project_path,
      );
      if (!proj) {
        toast.error(t("preview.toast.noProject"));
        return;
      }
      const r = await syncSessionTasks(s.session_id, s.provider, proj.id);
      if (r.total === 0) {
        toast.message(t("preview.toast.noTasks"));
      } else {
        toast.success(
          t("preview.toast.syncSuccess", {
            proj: proj.name,
            created: r.created,
            updated: r.updated,
            total: r.total,
          }),
        );
      }
    } catch (e) {
      toast.error(t("preview.toast.syncError", { msg: String(e instanceof Error ? e.message : e) }));
    } finally {
      setSyncing(false);
    }
  };

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("preview.selectHint")}</p>
      </div>
    );
  }

  const action =
    "rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground";

  return (
    <>
      <div className="flex h-full flex-col gap-3">
        {/* 顶部：会话信息 + 操作 */}
        <div className="shrink-0 border-b border-border pb-3">
          <div className="flex items-start justify-between gap-2">
            <h2 className="truncate text-sm font-semibold" title={session.project_path}>
              {session.project_name}
            </h2>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setDistillOpen(true)}
                className={action}
                title={t("preview.distillTitle")}
              >
                {t("preview.aiDistill")}
              </button>
              <button
                onClick={() => setMemoryOpen(true)}
                className={action}
                title={t("preview.distillMemoryTitle")}
              >
                {t("preview.distillMemory")}
              </button>
              <button
                onClick={() => setTaskDialogOpen(true)}
                className={action}
                title={t("preview.createTaskTitle")}
              >
                {t("preview.createTask")}
              </button>
              <button
                onClick={() => void syncTasks(session)}
                className={action}
                disabled={syncing}
                title={t("preview.syncTasksTitle")}
              >
                {syncing ? t("preview.syncingTasks") : t("preview.syncTasks")}
              </button>
              <button
                onClick={() => setRestoreTarget(session)}
                className={action}
                title={t("preview.restoreTitle")}
              >
                {t("preview.restore")}
              </button>
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{session.provider}</span>
            <span>{t("preview.messageCount", { n: session.message_count })}</span>
            <span className="ml-auto font-mono">{session.session_id.slice(0, 8)}…</span>
          </div>
        </div>

        {/* 会话备注（自动保存）。key 加前缀：兄弟节点若共用同一 session_id 作 key 会重复，
            触发 React 重复 key 的"复制/遗漏"——切换时会叠出多个，故各自加唯一前缀。 */}
        <SessionNoteEditor key={`note-${session.session_id}`} sessionId={session.session_id} />

        {/* 溯源摘要条：关联任务 / 提交 / 改动文件 收成一行胶囊，默认折叠，把空间还给对话 */}
        <SessionProvenance
          key={`prov-${session.session_id}`}
          session={session}
          tasksRefreshKey={linkedRefresh}
        />

        {/* 内联聊天：历史气泡 + 底部续聊（切换会话时 key 重置） */}
        <SessionChat key={`chat-${session.session_id}`} session={session} className="flex-1" />
      </div>

      {/* 恢复对话框 */}
      <RestoreDialog session={restoreTarget} onClose={() => setRestoreTarget(null)} />

      {/* AI 提炼沉淀对话框 */}
      <DistillDialog
        session={distillOpen ? session : null}
        onClose={() => setDistillOpen(false)}
      />

      {/* 提炼记忆对话框 */}
      <MemoryReviewDialog
        session={memoryOpen ? session : null}
        onClose={() => setMemoryOpen(false)}
      />

      {/* 从会话建任务对话框 */}
      {taskDialogOpen && (
        <CreateTaskFromSessionDialog
          session={session}
          onClose={() => {
            setTaskDialogOpen(false);
            setLinkedRefresh((n) => n + 1);
          }}
        />
      )}
    </>
  );
}
