import { useEffect, useRef, useState } from "react";
import { ipc } from "../../lib/tauri/ipc";
import type { Session } from "../../types/session";
import type { TimelineMessage } from "../../types/session";
import { RestoreDialog } from "./RestoreDialog";
import { SessionLinkedTasks } from "./SessionLinkedTasks";
import { SessionContinueDialog } from "./SessionContinueDialog";
import { CreateTaskFromSessionDialog } from "../board/CreateTaskFromSessionDialog";
import { DistillDialog } from "../chemistry/DistillDialog";

// ── 预览消息的显示数量上限 ────────────────────────────────
const PREVIEW_LIMIT = 10;

// ── 角色标签映射 ──────────────────────────────────────────
const ROLE_LABEL: Record<TimelineMessage["role"], string> = {
  user: "用户",
  assistant: "助手",
  system: "系统",
};

// ── Props ──────────────────────────────────────────────────
interface SessionPreviewPaneProps {
  /** 当前选中的会话；为 null 时展示空状态 */
  session: Session | null;
}

/**
 * 会话预览面板（右侧分栏）。
 * 选中会话后，调用 ipc.sessionTimeline 获取时间线消息并展示最近若干条。
 */
export function SessionPreviewPane({ session }: SessionPreviewPaneProps) {
  const [messages, setMessages] = useState<TimelineMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 控制恢复对话框：Enter 键触发时，直接填入当前 session
  const [restoreTarget, setRestoreTarget] = useState<Session | null>(null);
  // 控制"从会话建任务"对话框的显示状态
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  // 建任务对话框关闭后自增，触发「关联任务」列表刷新
  const [linkedRefresh, setLinkedRefresh] = useState(0);
  // 控制"在 AI 中继续"对话框
  const [continueOpen, setContinueOpen] = useState(false);
  // 控制"AI 提炼沉淀"对话框
  const [distillOpen, setDistillOpen] = useState(false);

  // 面板容器 ref，用于注册键盘监听
  const paneRef = useRef<HTMLDivElement>(null);

  // Enter 键：在预览面板聚焦时，触发恢复当前选中会话（默认新终端窗）
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // 仅在面板容器内（或面板内元素聚焦）时响应 Enter
      if (e.key === "Enter" && session && paneRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        setRestoreTarget(session);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [session]);

  // 每次选中的 session 变化时重新加载时间线
  useEffect(() => {
    if (!session) {
      setMessages([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    ipc.sessionTimeline(session.provider, session.session_id)
      .then((timeline) => {
        if (cancelled) return;
        // 只展示最近 PREVIEW_LIMIT 条
        setMessages(timeline.slice(-PREVIEW_LIMIT));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.session_id, session?.provider]);

  // ── 空状态 ────────────────────────────────────────────
  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">选择一个会话以预览</p>
      </div>
    );
  }

  // 直接使用 Rust 序列化的 project_name 字段
  const projectName = session.project_name;

  return (
    <>
    {/* tabIndex=0 使面板可聚焦，从而响应 Enter 快捷键 */}
    <div ref={paneRef} tabIndex={0} className="flex h-full flex-col gap-3 outline-none">
      {/* 顶部：会话基本信息 + 恢复按钮 */}
      <div className="shrink-0 border-b border-border pb-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="truncate text-sm font-semibold" title={session.project_path}>
            {projectName}
          </h2>
          {/* 操作按钮组：建任务 + 恢复 */}
          <div className="flex shrink-0 items-center gap-2">
            {/* 在 AI 中继续：预载会话历史，在应用内续聊 */}
            <button
              onClick={() => setContinueOpen(true)}
              className="rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="载入会话历史，在 AI 中继续对话"
            >
              AI 续聊
            </button>
            {/* AI 提炼沉淀：抽取候选任务/文档并写入项目 */}
            <button
              onClick={() => setDistillOpen(true)}
              className="rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="用 AI 从此会话提炼任务与文档，确认后写入项目"
            >
              AI 提炼
            </button>
            {/* 建任务按钮：打开"从会话建任务"对话框 */}
            <button
              onClick={() => setTaskDialogOpen(true)}
              className="rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="从此会话创建看板任务"
            >
              建任务
            </button>
            {/* 恢复按钮：点击打开恢复对话框；Enter 快捷键同样触发 */}
            <button
              onClick={() => setRestoreTarget(session)}
              className="rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="恢复会话（或按 Enter）"
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

      {/* 消息列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">加载预览…</p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-destructive">
            加载失败：{error}
          </p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">暂无消息记录</p>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={[
                  "rounded-lg border border-border p-3 text-sm",
                  // 用户消息和助手消息有不同的背景色，区分视觉层次
                  msg.role === "user"
                    ? "bg-card text-card-foreground"
                    : msg.role === "assistant"
                    ? "bg-accent text-accent-foreground"
                    : "bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {/* 角色标签 */}
                <div className="mb-1 text-xs font-semibold text-muted-foreground">
                  {ROLE_LABEL[msg.role] ?? msg.role}
                  {msg.timestamp && (
                    <span className="ml-2 font-normal opacity-70">{msg.timestamp}</span>
                  )}
                </div>
                {/* 消息正文：保留换行 */}
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部提示：仅展示最近 N 条 */}
      {!loading && !error && messages.length > 0 && (
        <p className="shrink-0 text-center text-xs text-muted-foreground">
          仅展示最近 {messages.length} 条消息
        </p>
      )}

      {/* 关联任务（本会话已衍生的看板任务，点击跳看板） */}
      <SessionLinkedTasks sessionId={session.session_id} refreshKey={linkedRefresh} />
    </div>

    {/* 恢复对话框：由"恢复"按钮或 Enter 键触发 */}
    <RestoreDialog
      session={restoreTarget}
      onClose={() => setRestoreTarget(null)}
    />

    {/* 在 AI 中继续对话框 */}
    <SessionContinueDialog
      session={continueOpen ? session : null}
      onClose={() => setContinueOpen(false)}
    />

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
          // 可能刚建了新任务 → 刷新「关联任务」列表
          setLinkedRefresh((n) => n + 1);
        }}
      />
    )}
    </>
  );
}
