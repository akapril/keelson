// SessionChat —— 会话中枢右侧内联聊天：展示会话历史(气泡) + 底部直接续聊(流式)。
// codex-gui 风格:用户右、助手左，等宽友好，滚动到底。续聊用配置的 AI（非重开 CLI 会话），
// 历史按会话持久化到 localStorage。
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { SentIcon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSettingsStore } from "@/store/settings";
import { ipc } from "@/lib/tauri/ipc";
import { cn } from "@/lib/utils";
import type { AiChatMessage } from "@/types/ai";
import type { Session } from "../../types/session";

// 送 AI 的上下文条数上限（仅限制发给模型的历史，不影响展示的完整时间线）
const CONTEXT_LIMIT = 20;

export function SessionChat({
  session,
  className,
}: {
  session: Session;
  className?: string;
}) {
  const navigate = useNavigate();
  // 历史时间线（完整、只读、不持久化）与续聊（本地持久化）分开，
  // 避免种子截断/持久化覆盖导致"内容不全、与列表不一致"。
  const [history, setHistory] = useState<AiChatMessage[]>([]);
  const [continued, setContinued] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [needConfig, setNeedConfig] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeStreamId = useRef<string | null>(null);

  // 用新 key，避免旧版（历史+续聊混存）数据被当作续聊重复展示
  const storeKey = `rework-ai-continue2-${session.session_id}`;

  // 展示 = 完整历史 + 续聊
  const messages = [...history, ...continued];

  // 切换会话：读完整时间线为历史 + 载入已存续聊。
  useEffect(() => {
    let cancelled = false;
    setNeedConfig(false);
    setSeedError(null);
    setHistory([]);
    // 载入该会话已保存的续聊（仅续聊，不含历史）
    try {
      const raw = localStorage.getItem(storeKey);
      setContinued(raw ? (JSON.parse(raw) as AiChatMessage[]) : []);
    } catch {
      setContinued([]);
    }
    // 拉完整时间线（不截断），作为只读历史
    ipc
      .sessionTimeline(session.provider, session.session_id)
      .then((tl) => {
        if (cancelled) return;
        setHistory(
          tl
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role, content: m.content })),
        );
        scrollToBottom();
      })
      .catch((e: unknown) => {
        if (!cancelled) setSeedError(String(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.session_id]);

  // 仅持久化续聊（非流式中）；为空则清除，避免残留
  useEffect(() => {
    if (loading) return;
    try {
      if (continued.length > 0) localStorage.setItem(storeKey, JSON.stringify(continued));
      else localStorage.removeItem(storeKey);
    } catch {
      /* ignore */
    }
  }, [continued, loading, storeKey]);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  // 流式更新落在续聊的最后一条（助手占位）
  const updateAssistant = (fn: (prev: string) => string) => {
    setContinued((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== "assistant") return prev;
      return [...prev.slice(0, -1), { ...last, content: fn(last.content) }];
    });
    scrollToBottom();
  };

  const handleStop = () => {
    const id = activeStreamId.current;
    if (id) void ipc.aiCancelStream(id);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const aiConfig = useSettingsStore.getState().aiConfig;
    if (!aiConfig.api_key) {
      setNeedConfig(true);
      return;
    }
    setNeedConfig(false);

    const userMsg: AiChatMessage = { role: "user", content: text };
    // 追加到续聊（用户消息 + 助手占位，流式往占位里填）
    setContinued((prev) => [...prev, userMsg, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);
    scrollToBottom();

    const sys: AiChatMessage = {
      role: "system",
      content: `以下对话是用户此前在「${session.project_name}」项目中与 ${session.provider} CLI 的会话历史，请理解上下文并继续协助，用简洁中文回答。`,
    };
    // 送 AI 的上下文：完整历史+续聊+本轮用户消息，截断到最近 CONTEXT_LIMIT 条（控成本）
    const ctx = [...history, ...continued, userMsg].slice(-CONTEXT_LIMIT);
    const reqMsgs: AiChatMessage[] = [sys, ...ctx];
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
    <div className={cn("flex min-h-0 flex-col", className)}>
      {/* 消息流（codex-gui 风格气泡） */}
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-2">
        {seedError && (
          <p className="text-center text-sm text-destructive">载入历史失败：{seedError}</p>
        )}
        {messages.length === 0 && !seedError && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            此会话暂无消息，或直接在下方继续对话。
          </p>
        )}
        {messages.map((m, i) => {
          const isUser = m.role === "user";
          const isError = m.role === "assistant" && m.content.startsWith("请求失败：");
          const isLast = i === messages.length - 1;
          const display =
            m.content || (m.role === "assistant" && isLast && loading ? "▍" : "");
          return (
            <div key={i} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                  isUser
                    ? "bg-primary/10 text-foreground"
                    : isError
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-foreground",
                )}
              >
                {display}
              </div>
            </div>
          );
        })}
      </div>

      {/* 未配置密钥引导 */}
      {needConfig && (
        <div className="mx-1 mb-2 rounded-xl border border-border bg-card p-3 text-sm">
          <p className="text-foreground">尚未配置 AI 服务</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => navigate("/settings")}
          >
            去设置
          </Button>
        </div>
      )}

      {/* 输入区（内联续聊） */}
      <div className="flex shrink-0 items-end gap-2 border-t border-border pt-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="继续对话，Enter 发送，Shift+Enter 换行"
          className="min-h-11 flex-1"
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
    </div>
  );
}
