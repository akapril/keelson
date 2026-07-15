import { useEffect, useState } from "react";
import { ipc } from "../../lib/tauri/ipc";
import type { Session } from "../../types/session";
import type { TimelineMessage } from "../../types/session";

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
    <div className="flex h-full flex-col gap-3">
      {/* 顶部：会话基本信息 */}
      <div className="shrink-0 border-b border-border pb-3">
        <h2 className="truncate text-sm font-semibold" title={session.project_path}>
          {projectName}
        </h2>
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
    </div>
  );
}
