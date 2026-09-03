// web/panels/SessionTranscript.tsx — 会话记录查看器（只读）
//
// 目标：在 web 端读某会话已存的完整对话记录（后端 /api/sessions_timeline 读磁盘 jsonl），
// 干净展示 + 一键复制整段对话。相比从终端刮屏，这是 claude/codex 历史的「正确来源」：
// 完整、可原生选择、可复制。
//
// 只读、轻量：不接 AI 续聊 / resume / 路由（那些是桌面 SessionChat 的职责，且 ai 能力在 web 默认关）。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";
import { cn } from "@/lib/utils";
import type { Session, TimelineMessage } from "@/types/session";

/** 展示用只保留 user/assistant/tool（system 等丢弃，与桌面时间线一致）。 */
function displayable(m: TimelineMessage): boolean {
  return m.role === "user" || m.role === "assistant" || m.role === "tool";
}

/** 把时间线拼成纯文本（角色标签 + 正文），供「复制全部」——完整、干净、忠实原文。 */
function toPlainText(
  messages: TimelineMessage[],
  roleLabel: (role: string) => string,
): string {
  return messages
    .map((m) => `【${roleLabel(m.role)}】\n${m.content}`)
    .join("\n\n");
}

export interface SessionTranscriptProps {
  /** 要查看记录的会话 */
  session: Session;
  /** 关闭浮层 */
  onClose: () => void;
}

/**
 * 会话记录浮层：读完整时间线，只读展示（用户右/助手左/工具居中 chip）+ 复制全部。
 * 覆盖在工作台之上（absolute inset-0），移动端友好。
 */
export function SessionTranscript({ session, onClose }: SessionTranscriptProps) {
  const { t } = useTranslation("web");
  type LoadState = "loading" | "loaded" | "empty" | "error";
  const [state, setState] = useState<LoadState>("loading");
  const [messages, setMessages] = useState<TimelineMessage[]>([]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    ipc
      .sessionTimeline(session.provider, session.session_id)
      .then((tl) => {
        if (cancelled) return;
        const msgs = tl.filter(displayable);
        setMessages(msgs);
        setState(msgs.length === 0 ? "empty" : "loaded");
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[SessionTranscript] 读取会话记录失败:", e);
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [session.provider, session.session_id]);

  const roleLabel = (role: string) => t(`transcript.role.${role}`, { defaultValue: role });

  const copyAll = () => {
    if (messages.length === 0) return;
    void navigator.clipboard.writeText(toPlainText(messages, roleLabel)).then(
      () => toast.success(t("transcript.copied")),
      () => toast.error(t("transcript.copyError")),
    );
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-background">
      {/* 顶栏：标题 + 会话名 + 复制/关闭 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <span className="text-sm font-medium">{t("transcript.title")}</span>
          <span className="ml-2 truncate text-xs text-muted-foreground" title={session.project_path}>
            {session.project_name} · {session.provider}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={copyAll}
            disabled={state !== "loaded"}
            className="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          >
            {t("transcript.copyAll")}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("transcript.close")}
            className="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 消息流：可原生选择复制 */}
      <div className="min-h-0 flex-1 select-text space-y-3 overflow-y-auto px-3 py-3">
        {state === "loading" && (
          <p className="py-8 text-center text-xs text-muted-foreground" aria-live="polite">
            {t("transcript.loading")}
          </p>
        )}
        {state === "error" && (
          <p className="py-8 text-center text-sm text-destructive">{t("transcript.error")}</p>
        )}
        {state === "empty" && (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("transcript.empty")}</p>
        )}
        {state === "loaded" &&
          messages.map((m, idx) => {
            // 工具调用：居中紧凑 chip；用户：右侧气泡；助手/其它：左侧气泡。
            if (m.role === "tool") {
              return (
                <div key={idx} className="flex justify-center">
                  <span className="inline-flex max-w-[88%] items-center gap-1.5 truncate rounded-full bg-muted/50 px-2.5 py-0.5 text-xs text-muted-foreground">
                    🔧 <span className="truncate">{m.content}</span>
                  </span>
                </div>
              );
            }
            const isUser = m.role === "user";
            return (
              <div key={idx} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                    isUser ? "bg-primary/10 text-foreground" : "bg-muted text-foreground",
                  )}
                >
                  {m.content}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
