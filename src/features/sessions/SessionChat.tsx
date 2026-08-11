// SessionChat —— 会话中枢右侧内联聊天：展示会话历史(气泡) + 底部直接续聊(流式)。
// codex-gui 风格:用户右、助手左，等宽友好，滚动到底。续聊用配置的 AI（非重开 CLI 会话），
// 历史按会话持久化到 localStorage。
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { SentIcon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { useSettingsStore } from "@/store/settings";
import { ipc } from "@/lib/tauri/ipc";
import { cn } from "@/lib/utils";
import { getCachedTimeline, setCachedTimeline } from "./timeline-cache";
import { usePromptInsert } from "@/features/prompts/usePromptInsert";
import { getContinueMode, setContinueMode, type ContinueMode } from "./continue-mode";
import { useRestoreStore } from "@/store/restore";
import { toast } from "sonner";
import type { AiChatMessage } from "@/types/ai";
import type { Session } from "../../types/session";

// 送 AI 的上下文条数上限（仅限制发给模型的历史，不影响展示的完整时间线）
const CONTEXT_LIMIT = 20;

// 初始只渲染最近 N 条气泡，更早的按需展开（长会话上百条时避免一次性渲染 markdown 卡顿）
const VISIBLE_LIMIT = 60;

// 单条历史气泡（memo）：完整会话历史可能很长，流式续聊时只重渲变化的那条，
// 已完成的助手气泡不重复解析 markdown（消除 O(n²) 卡顿）。
const HistoryBubble = memo(function HistoryBubble({
  message,
  isStreaming,
}: {
  message: AiChatMessage;
  isStreaming: boolean;
}) {
  const { t } = useTranslation("sessions");
  const isUser = message.role === "user";
  // 错误消息用内部哨兵前缀标记（\x00ERR:）区分正常内容
  const isError = message.role === "assistant" && message.content.startsWith("\x00ERR:");
  const streamingThis = message.role === "assistant" && isStreaming;
  // 错误消息：去除哨兵前缀后显示翻译后的错误提示
  const errorBody = isError ? message.content.slice("\x00ERR:".length) : "";
  const display = isError
    ? t("chat.requestError", { msg: errorBody })
    : message.content || (streamingThis ? "▍" : "");
  // 会话消息可能是 markdown：助手正文渲染 markdown；用户/错误/流式中保持纯文本
  const renderMarkdown =
    message.role === "assistant" && !isError && !!message.content && !streamingThis;
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[88%] break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
          !renderMarkdown && "whitespace-pre-wrap",
          isUser
            ? "bg-primary/10 text-foreground"
            : isError
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-foreground",
        )}
      >
        {renderMarkdown ? <Markdown content={message.content} /> : display}
      </div>
    </div>
  );
});

export function SessionChat({
  session,
  className,
}: {
  session: Session;
  className?: string;
}) {
  const { t } = useTranslation("sessions");
  const navigate = useNavigate();
  // 历史时间线（完整、只读、不持久化）与续聊（本地持久化）分开，
  // 避免种子截断/持久化覆盖导致"内容不全、与列表不一致"。
  const [history, setHistory] = useState<AiChatMessage[]>([]);
  const [continued, setContinued] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [needConfig, setNeedConfig] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  // 历史时间线加载中：区分「正在读取」与「真的没有消息」，避免误以为无数据
  const [loadingHistory, setLoadingHistory] = useState(true);
  // 是否展开更早的消息（长会话默认只显示最近 VISIBLE_LIMIT 条）
  const [showAll, setShowAll] = useState(false);
  // 续聊模式：应用内(分叉重放) / 终端续接(真 resume 写回原会话)
  const [mode, setMode] = useState<ContinueMode>(() => getContinueMode());
  const restore = useRestoreStore((s) => s.restore);
  const chooseMode = (m: ContinueMode) => {
    setMode(m);
    setContinueMode(m);
  };
  // 终端续接：用 claude/codex --resume 在终端真正接着原会话（写回磁盘、真同步）
  const resumeInTerminal = () => {
    void restore(session, false).catch((e) =>
      toast.error(t("chat.resumeError", { msg: String(e) })),
    );
  };
  const listRef = useRef<HTMLDivElement>(null);
  const activeStreamId = useRef<string | null>(null);
  // 指令库插入（按钮 + 斜杠 /名称）
  const promptInsert = usePromptInsert({
    input,
    setInput,
    ctx: { project: session.project_name, repoPath: session.project_path },
    disabled: loading,
  });

  // 用新 key，避免旧版（历史+续聊混存）数据被当作续聊重复展示
  const storeKey = `keelson-ai-continue2-${session.session_id}`;

  // 展示 = 完整历史 + 续聊（useMemo：history/continued 变才重建，避免每次输入击键重展开）
  const messages = useMemo(
    () => [...history, ...continued],
    [history, continued],
  );

  // 切换会话：读完整时间线为历史 + 载入已存续聊。
  useEffect(() => {
    let cancelled = false;
    setNeedConfig(false);
    setSeedError(null);
    setHistory([]);
    setShowAll(false);
    setLoadingHistory(true);
    // 载入该会话已保存的续聊（仅续聊，不含历史）
    try {
      const raw = localStorage.getItem(storeKey);
      setContinued(raw ? (JSON.parse(raw) as AiChatMessage[]) : []);
    } catch {
      setContinued([]);
    }
    // 先查前端缓存（键含 message_count，会话有新消息会自动失效）：命中则秒开、免读后端
    const cached = getCachedTimeline(
      session.provider,
      session.session_id,
      session.message_count,
    );
    if (cached) {
      setHistory(cached);
      setLoadingHistory(false);
      scrollToBottom();
      return () => {
        cancelled = true;
      };
    }
    // 未命中：拉完整时间线（不截断），作为只读历史，并写入缓存
    ipc
      .sessionTimeline(session.provider, session.session_id)
      .then((tl) => {
        if (cancelled) return;
        const msgs = tl
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role, content: m.content }));
        setHistory(msgs);
        setCachedTimeline(
          session.provider,
          session.session_id,
          session.message_count,
          msgs,
        );
        scrollToBottom();
      })
      .catch((e: unknown) => {
        if (!cancelled) setSeedError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
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
        else if (ev.kind === "error") updateAssistant(() => `\x00ERR:${ev.text ?? ""}`);
      });
      updateAssistant((c) => (c === "" ? t("chat.noReply") : c));
    } catch (e) {
      updateAssistant(() => `\x00ERR:${String(e)}`);
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
          <p className="text-center text-sm text-destructive">{t("chat.loadHistoryError", { msg: seedError })}</p>
        )}
        {/* 加载中骨架：区分「正在读取会话消息」与「真的没有消息」 */}
        {loadingHistory && messages.length === 0 && !seedError && (
          <div className="space-y-3 py-2" aria-live="polite">
            <p className="text-center text-xs text-muted-foreground">{t("chat.loadingHistory")}</p>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={cn("flex", i % 2 ? "justify-end" : "justify-start")}
              >
                <div className="h-10 w-2/3 animate-pulse rounded-2xl bg-muted" />
              </div>
            ))}
          </div>
        )}
        {!loadingHistory && messages.length === 0 && !seedError && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("chat.emptyHistory")}
          </p>
        )}
        {/* 长会话分页：默认只渲染最近 VISIBLE_LIMIT 条，顶部按钮展开更早的 */}
        {messages.length > VISIBLE_LIMIT && !showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mx-auto block rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {t("chat.showEarlier", { n: messages.length - VISIBLE_LIMIT })}
          </button>
        )}
        {(showAll ? messages : messages.slice(-VISIBLE_LIMIT)).map((m, idx) => {
          // 绝对索引：分页切片后仍需与"最后一条=流式中"对齐、并保持稳定 key
          const absolute = showAll ? idx : Math.max(0, messages.length - VISIBLE_LIMIT) + idx;
          return (
            <HistoryBubble
              key={absolute}
              message={m}
              isStreaming={absolute === messages.length - 1 && loading}
            />
          );
        })}
      </div>

      {/* 未配置密钥引导 */}
      {needConfig && (
        <div className="mx-1 mb-2 rounded-xl border border-border bg-card p-3 text-sm">
          <p className="text-foreground">{t("chat.noAiConfig")}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => navigate("/settings")}
          >
            {t("chat.goSettings")}
          </Button>
        </div>
      )}

      {/* 续聊模式开关：应用内(分叉,快) / 终端续接(真接原会话,写回磁盘) */}
      <div className="mt-2 flex shrink-0 items-center gap-1.5 border-t border-border pt-2 text-xs">
        <span className="text-muted-foreground">{t("chat.continueMode")}</span>
        <div className="inline-flex rounded-lg border border-border p-0.5">
          <button
            type="button"
            onClick={() => chooseMode("inapp")}
            className={cn(
              "rounded-md px-2 py-0.5 transition-colors",
              mode === "inapp" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("chat.modeInapp")}
          </button>
          <button
            type="button"
            onClick={() => chooseMode("terminal")}
            className={cn(
              "rounded-md px-2 py-0.5 transition-colors",
              mode === "terminal" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("chat.modeTerminal")}
          </button>
        </div>
        <span className="ml-1 truncate text-[11px] text-muted-foreground/70">
          {mode === "inapp"
            ? t("chat.modeInappDesc")
            : t("chat.modeTerminalDesc")}
        </span>
      </div>

      {/* 输入区：应用内=内联续聊；终端续接=一键在终端恢复 */}
      {mode === "terminal" ? (
        <div className="flex shrink-0 items-center justify-between gap-2 pt-3">
          <p className="text-xs text-muted-foreground">
            {t("chat.terminalHint", { provider: session.provider })}
          </p>
          <Button onClick={resumeInTerminal}>{t("chat.resumeInTerminal")}</Button>
        </div>
      ) : (
        <div className="flex shrink-0 items-end gap-2 pt-3">
          <div className="relative min-w-0 flex-1">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (promptInsert.onKeyDown(e)) return;
                onKeyDown(e);
              }}
              placeholder={t("chat.inputPlaceholder")}
              className="min-h-11 w-full"
              disabled={loading}
            />
            {promptInsert.overlay}
          </div>
          {promptInsert.button}
          {loading ? (
            <Button variant="outline" onClick={handleStop}>
              {t("chat.stop")}
            </Button>
          ) : (
            <Button onClick={() => void send()} disabled={!input.trim()}>
              <HugeiconsIcon icon={SentIcon} strokeWidth={2} />
              {t("chat.send")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
