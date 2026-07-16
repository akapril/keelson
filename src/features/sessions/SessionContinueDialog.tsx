// SessionContinueDialog —— 「在 AI 中继续」：把某本地 CLI 会话的历史时间线
// 预载为上下文，在应用内用配置的 AI 继续对话（区别于「恢复」到终端）。
// 复用 ipc.aiChatStream 流式；对话历史按会话持久化到 localStorage。
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { SentIcon } from "@hugeicons/core-free-icons";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSettingsStore } from "@/store/settings";
import { ipc } from "@/lib/tauri/ipc";
import type { AiChatMessage } from "@/types/ai";
import type { Session } from "../../types/session";

// 预载进上下文的历史消息条数上限（控制 token/费用）
const SEED_LIMIT = 16;

interface SessionContinueDialogProps {
  session: Session | null;
  onClose: () => void;
}

export function SessionContinueDialog({ session, onClose }: SessionContinueDialogProps) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [needConfig, setNeedConfig] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeStreamId = useRef<string | null>(null);

  const storeKey = session ? `rework-ai-continue-${session.session_id}` : "";

  // 打开会话时：优先载入已保存的续聊历史；否则拉取时间线作为预载上下文。
  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    // 已有续聊记录 → 直接恢复
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        setMessages(JSON.parse(raw) as AiChatMessage[]);
        setSeedError(null);
        return;
      }
    } catch {
      /* ignore */
    }

    // 无记录 → 拉取会话时间线，取最近若干条作为预载历史
    setMessages([]);
    ipc
      .sessionTimeline(session.provider, session.session_id)
      .then((tl) => {
        if (cancelled) return;
        const seed: AiChatMessage[] = tl
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(-SEED_LIMIT)
          .map((m) => ({ role: m.role, content: m.content }));
        setMessages(seed);
        setSeedError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setSeedError(String(e));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.session_id]);

  // 续聊历史持久化（非流式中）
  useEffect(() => {
    if (!session || loading) return;
    try {
      if (messages.length > 0) localStorage.setItem(storeKey, JSON.stringify(messages));
    } catch {
      /* ignore */
    }
  }, [messages, loading, session, storeKey]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const updateAssistant = (fn: (prev: string) => string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== "assistant") return prev;
      return [...prev.slice(0, -1), { ...last, content: fn(last.content) }];
    });
    scrollToBottom();
  };

  // 系统提示：说明这是对某 CLI 会话的延续
  const systemPrompt = useMemo(() => {
    if (!session) return "";
    return `你是编程助手。以下对话是用户此前在「${session.project_name}」项目中与 ${session.provider} CLI 的会话历史，请理解上下文并继续协助，用简洁中文回答。`;
  }, [session]);

  const handleStop = () => {
    const id = activeStreamId.current;
    if (id) void ipc.aiCancelStream(id);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading || !session) return;

    const aiConfig = useSettingsStore.getState().aiConfig;
    if (!aiConfig.api_key) {
      setNeedConfig(true);
      return;
    }
    setNeedConfig(false);

    const userMsg: AiChatMessage = { role: "user", content: text };
    const history = messages;
    setMessages([...history, userMsg, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);
    scrollToBottom();

    const reqMsgs: AiChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...history,
      userMsg,
    ];
    const streamId = crypto.randomUUID();
    activeStreamId.current = streamId;

    try {
      await ipc.aiChatStream(aiConfig, reqMsgs, streamId, (ev) => {
        if (ev.kind === "delta" && ev.text) updateAssistant((c) => c + ev.text);
        else if (ev.kind === "error") updateAssistant(() => `请求失败：${ev.text ?? ""}`);
      });
      updateAssistant((c) => (c === "" ? "（无回复）" : c));
    } catch (e) {
      updateAssistant(() => `请求失败：${String(e)}`);
    } finally {
      activeStreamId.current = null;
      setLoading(false);
      scrollToBottom();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <Dialog open={!!session} onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent className="flex h-[80vh] max-h-[80vh] w-full max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>在 AI 中继续会话</DialogTitle>
          <DialogDescription>
            已载入该会话最近 {SEED_LIMIT} 条消息作为上下文，可直接继续对话（不影响原会话文件）。
          </DialogDescription>
        </DialogHeader>

        {/* 消息列表 */}
        <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-2">
          {seedError && (
            <p className="text-center text-sm text-destructive">
              载入会话历史失败：{seedError}
            </p>
          )}
          {messages.map((m, i) => {
            const isUser = m.role === "user";
            const isError = m.role === "assistant" && m.content.startsWith("请求失败：");
            const isLast = i === messages.length - 1;
            const display =
              m.content || (m.role === "assistant" && isLast && loading ? "▍" : "");
            return (
              <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
                    isUser
                      ? "bg-primary/10 text-foreground"
                      : isError
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted text-foreground"
                  }`}
                >
                  {display}
                </div>
              </div>
            );
          })}
        </div>

        {needConfig && (
          <div className="rounded-xl border border-border bg-card p-4 text-sm">
            <p className="text-foreground">尚未配置 AI 服务</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => {
                onClose();
                navigate("/settings");
              }}
            >
              去设置
            </Button>
          </div>
        )}

        {/* 输入区 */}
        <div className="flex shrink-0 items-end gap-2 border-t border-border pt-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            className="min-h-16 flex-1"
            disabled={loading}
          />
          {loading ? (
            <Button variant="outline" onClick={handleStop}>
              停止
            </Button>
          ) : (
            <Button onClick={() => void send()} disabled={!input.trim()}>
              <HugeiconsIcon icon={SentIcon} strokeWidth={2} />
              发送
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
