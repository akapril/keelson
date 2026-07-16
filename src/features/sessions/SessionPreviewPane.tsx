import { useEffect, useState } from "react";
import type { Session } from "../../types/session";
import { useSessionMetaStore } from "../../store/session-meta";
import { Textarea } from "@/components/ui/textarea";
import { RestoreDialog } from "./RestoreDialog";
import { SessionLinkedTasks } from "./SessionLinkedTasks";
import { SessionChat } from "./SessionChat";
import { CreateTaskFromSessionDialog } from "../board/CreateTaskFromSessionDialog";
import { DistillDialog } from "../chemistry/DistillDialog";

/** 会话备注编辑器（存 session_notes，跟随配置后端；自动保存）。 */
function SessionNoteEditor({ sessionId }: { sessionId: string }) {
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
    const t = setTimeout(() => void setNote(sessionId, text), 800);
    return () => clearTimeout(t);
  }, [text, sessionId, notes, setNote]);

  return (
    <Textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder="会话备注（自动保存）"
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
  const [restoreTarget, setRestoreTarget] = useState<Session | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [linkedRefresh, setLinkedRefresh] = useState(0);
  const [distillOpen, setDistillOpen] = useState(false);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">选择一个会话以预览</p>
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
                title="用 AI 从此会话提炼任务与文档，确认后写入项目"
              >
                AI 提炼
              </button>
              <button
                onClick={() => setTaskDialogOpen(true)}
                className={action}
                title="从此会话创建看板任务"
              >
                建任务
              </button>
              <button
                onClick={() => setRestoreTarget(session)}
                className={action}
                title="在终端恢复该 CLI 会话"
              >
                恢复
              </button>
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{session.provider}</span>
            <span>{session.message_count} 条消息</span>
            <span className="ml-auto font-mono">{session.session_id.slice(0, 8)}…</span>
          </div>
        </div>

        {/* 会话备注（自动保存） */}
        <SessionNoteEditor key={session.session_id} sessionId={session.session_id} />

        {/* 关联任务（本会话已衍生的看板任务，点击跳看板） */}
        <SessionLinkedTasks sessionId={session.session_id} refreshKey={linkedRefresh} />

        {/* 内联聊天：历史气泡 + 底部续聊（切换会话时 key 重置） */}
        <SessionChat key={session.session_id} session={session} className="flex-1" />
      </div>

      {/* 恢复对话框 */}
      <RestoreDialog session={restoreTarget} onClose={() => setRestoreTarget(null)} />

      {/* AI 提炼沉淀对话框 */}
      <DistillDialog
        session={distillOpen ? session : null}
        onClose={() => setDistillOpen(false)}
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
