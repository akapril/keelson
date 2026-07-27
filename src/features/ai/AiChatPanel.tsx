// AiChatPanel —— 项目级 AI 对话面板（流式 + 可选项目上下文/RAG）。
// 消息仅本地内存（不持久化，YAGNI）；流式经 ipc.aiChatStream 逐块渲染。
// 「包含项目上下文」开启后，注入本项目的文档 + 关联会话作为参考资料。
import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

// ── 对话历史本地持久化（按项目隔离；懒读避免挂载竞态删存档） ──
const chatKey = (projectId: string) => `rework-ai-chat-${projectId}`;
function loadChat(projectId: string): AiChatMessage[] {
  try {
    const raw = localStorage.getItem(chatKey(projectId));
    return raw ? (JSON.parse(raw) as AiChatMessage[]) : [];
  } catch {
    return [];
  }
}
function saveChat(projectId: string, messages: AiChatMessage[]): void {
  try {
    if (messages.length > 0) localStorage.setItem(chatKey(projectId), JSON.stringify(messages));
    else localStorage.removeItem(chatKey(projectId));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { SentIcon, AiChat02Icon, Delete02Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { useSettingsStore } from "@/store/settings";
import { ipc } from "@/lib/tauri/ipc";
import type { AiChatMessage, AiConfig, ToolChatMessage } from "@/types/ai";
import { buildProjectContext } from "./project-context";
import { runAgent } from "./agent-tools";
import { usePromptInsert } from "@/features/prompts/usePromptInsert";

// 工具调用参数的简短提示（气泡上展示，如 · 标题 / #id）
function shortArgs(json: string): string {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const bits: string[] = [];
    if (o.title) bits.push(String(o.title));
    if (o.task_id) bits.push(`#${String(o.task_id).slice(0, 6)}`);
    if (o.doc_id) bits.push(`#${String(o.doc_id).slice(0, 6)}`);
    const s = bits.join(" ");
    return s ? `· ${s}` : "";
  } catch {
    return "";
  }
}

// 从工具结果 JSON 提取简短错误信息（返回 error 字段原文；无法解析时返回英文 sentinel 供调用方映射）
function briefErr(result: string): string {
  try {
    const o = JSON.parse(result) as { error?: string };
    return String(o.error ?? "TOOL_FAILED");
  } catch {
    return "TOOL_FAILED";
  }
}

// 错误内容前缀 sentinel（English，与 localStorage 兼容）
const REQUEST_FAILED_PREFIX = "REQUEST_FAILED:";

// 单条消息气泡（memo）：流式时只有内容变化的那条（最后一条）重渲染，
// 已完成的助手气泡不再重复解析 markdown —— 消除长对话流式时的卡顿。
const MessageRow = memo(function MessageRow({
  message,
  isStreaming,
}: {
  message: AiChatMessage;
  isStreaming: boolean;
}) {
  const { t } = useTranslation("ai");

  // 工具活动行（role=system）：居中小胶囊
  if (message.role === "system") {
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
          {message.content}
        </span>
      </div>
    );
  }
  const isUser = message.role === "user";
  const isError = message.role === "assistant" && message.content.startsWith(REQUEST_FAILED_PREFIX);
  const streamingThis = message.role === "assistant" && isStreaming;
  // 流式中的空助手气泡显示光标
  const display = isError
    ? t("chat.requestError", { msg: message.content.slice(REQUEST_FAILED_PREFIX.length) })
    : message.content || (streamingThis ? "▍" : "");
  // 流式中先纯文本，结束后再 markdown（避免每 token 全量重解析）
  const renderMarkdown =
    message.role === "assistant" && !isError && !!message.content && !streamingThis;
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
          isUser
            ? "whitespace-pre-wrap bg-primary/10 text-foreground"
            : isError
              ? "whitespace-pre-wrap bg-destructive/10 text-destructive"
              : renderMarkdown
                ? "bg-muted text-foreground"
                : "whitespace-pre-wrap bg-muted text-foreground"
        }`}
      >
        {renderMarkdown ? <Markdown content={message.content} /> : display}
      </div>
    </div>
  );
});

interface AiChatPanelProps {
  projectId: string;
  projectName: string;
  repoPath?: string;
}

export function AiChatPanel({ projectId, projectName, repoPath }: AiChatPanelProps) {
  const { t } = useTranslation("ai");
  const navigate = useNavigate();
  // 懒初始化：首帧即从 localStorage 载入本项目历史（避免"空数组先删存档"的挂载竞态）
  const [messages, setMessages] = useState<AiChatMessage[]>(() => loadChat(projectId));
  // 记录当前 messages 属于哪个项目（切项目时按此保存/加载，避免串项目）
  const msgProjectRef = useRef(projectId);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [needConfig, setNeedConfig] = useState(false);
  // 指令库插入（按钮 + 斜杠 /名称）
  const promptInsert = usePromptInsert({
    input,
    setInput,
    ctx: { project: projectName, repoPath },
    disabled: loading,
  });
  // 是否把项目文档+会话注入为上下文（RAG）
  const [includeContext, setIncludeContext] = useState(false);
  // 工具模式：允许 AI 调用工具建/改看板任务与文档
  const [useTools, setUseTools] = useState(false);
  // 响应式派生：当前 provider 是否为本地 CLI（不支持工具模式）
  const provider = useSettingsStore((s) => s.aiConfig.provider);
  const isCli = provider === "claude-cli" || provider === "codex-cli";
  const listRef = useRef<HTMLDivElement>(null);
  // 当前进行中的流 id（用于「停止生成」）
  const activeStreamId = useRef<string | null>(null);

  // 停止当前生成
  const handleStop = () => {
    const id = activeStreamId.current;
    if (id) void ipc.aiCancelStream(id);
  };

  // 切项目（不卸载而 projectId 变）时载入该项目历史；挂载时已由懒初始化覆盖，故跳过。
  useEffect(() => {
    if (msgProjectRef.current === projectId) return; // 挂载首次：与懒初始化一致，无需重载
    msgProjectRef.current = projectId;
    setMessages(loadChat(projectId));
  }, [projectId]);

  // 每轮对话结束后（非流式中）持久化历史（按 messages 所属项目存，避免串项目）。
  useEffect(() => {
    if (loading) return;
    saveChat(msgProjectRef.current, messages);
  }, [loading, messages]);

  // 清空当前项目对话
  const clearConversation = () => {
    setMessages([]);
    saveChat(projectId, []);
  };

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  // 更新（追加/替换）最后一条助手消息的正文
  const updateAssistant = (fn: (prevContent: string) => string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== "assistant") return prev;
      return [...prev.slice(0, -1), { ...last, content: fn(last.content) }];
    });
    scrollToBottom();
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const aiConfig = useSettingsStore.getState().aiConfig;
    // CLI provider 无需 api_key；其余 provider 仍要求密钥
    const isCli =
      aiConfig.provider === "claude-cli" || aiConfig.provider === "codex-cli";
    if (!isCli && !aiConfig.api_key) {
      setNeedConfig(true);
      return;
    }
    setNeedConfig(false);

    // 工具模式走 agent loop（非流式）；CLI provider 不支持，直接跳过走流式
    if (useTools && !isCli) {
      await sendWithTools(text, aiConfig);
      return;
    }

    const system: AiChatMessage = {
      role: "system",
      content: `你是「${projectName}」项目的 AI 助手，用简洁中文回答。`,
    };
    const userMsg: AiChatMessage = { role: "user", content: text };
    const history = messages;
    // 追加用户消息 + 一个空助手占位（流式往里填）
    setMessages([...history, userMsg, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);
    scrollToBottom();

    // 组装请求消息：system(+可选上下文) + 历史 + 用户
    const reqMsgs: AiChatMessage[] = [system];
    if (includeContext) {
      try {
        // 传入当前提问，按相关性挑选最相关的文档/会话片段
        const ctx = await buildProjectContext(projectId, repoPath, text);
        if (ctx) {
          reqMsgs.push({
            role: "system",
            content: `以下是本项目的相关资料，回答时可参考：\n\n${ctx}`,
          });
        }
      } catch {
        /* 上下文构造失败不阻断对话 */
      }
    }
    // 过滤掉「系统」显示行（工具活动提示），只把 user/assistant 送给模型
    reqMsgs.push(...history.filter((m) => m.role !== "system"), userMsg);

    // 本次流的 id，用于「停止生成」
    const streamId = crypto.randomUUID();
    activeStreamId.current = streamId;

    try {
      // CLI + 工具模式：让 CLI 自主 agent 循环 + 已装 MCP（含 rework）运行（withTools=true）
      await ipc.aiChatStream(
        aiConfig,
        reqMsgs,
        streamId,
        (ev) => {
          if (ev.kind === "delta" && ev.text) {
            updateAssistant((c) => c + ev.text);
          } else if (ev.kind === "error") {
            // 存英文 sentinel 前缀，MessageRow 渲染时按 i18n key 翻译
            updateAssistant(() => `${REQUEST_FAILED_PREFIX}${ev.text ?? ""}`);
          }
        },
        useTools && isCli,
        // 项目仓库路径 → CLI 在该目录运行，能看到对应项目文件
        repoPath,
      );
      // 结束时助手仍为空 → 给个占位
      updateAssistant((c) => (c === "" ? t("chat.noReply") : c));
    } catch (e) {
      // 存英文 sentinel 前缀，MessageRow 渲染时按 i18n key 翻译
      updateAssistant(() => `${REQUEST_FAILED_PREFIX}${String(e)}`);
    } finally {
      activeStreamId.current = null;
      setLoading(false);
      scrollToBottom();
    }
  };

  // 工具模式：driven by agent loop（可调用工具建/改看板任务与文档）
  const sendWithTools = async (text: string, aiConfig: AiConfig) => {
    const userMsg: AiChatMessage = { role: "user", content: text };
    const history = messages;
    setMessages([...history, userMsg]);
    setInput("");
    setLoading(true);
    scrollToBottom();

    const sys: ToolChatMessage = {
      role: "system",
      content: `你是「${projectName}」项目的 AI 助手。你可以调用工具读取/修改本项目的看板任务与文档；执行修改前先用 list_* 了解现状，操作后用简洁中文说明你做了什么。`,
    };
    // 只把 user/assistant 历史送入模型（排除工具活动的「系统」显示行）
    const convo: ToolChatMessage[] = [
      sys,
      ...history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: text },
    ];

    try {
      const final = await runAgent(
        aiConfig,
        convo,
        { projectId },
        {
          onToolCall: (call) => {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: `🔧 ${call.name} ${shortArgs(call.arguments)}` },
            ]);
            scrollToBottom();
          },
          onToolResult: (call, result) => {
            const ok = !/"ok"\s*:\s*false/.test(result);
            // briefErr 返回 error 字段原文（非中文 LLM prompt 错误），或 "TOOL_FAILED" sentinel
            const errMsg = briefErr(result) === "TOOL_FAILED"
              ? t("chat.toolFailed")
              : briefErr(result);
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: ok
                  ? `✓ ${call.name} ${t("chat.toolDone")}`
                  : `✗ ${call.name}：${errMsg}`,
              },
            ]);
            scrollToBottom();
          },
          onAssistantText: (txt) => {
            setMessages((prev) => [...prev, { role: "assistant", content: txt }]);
            scrollToBottom();
          },
        },
      );
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: final || t("chat.done") },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        // 存英文 sentinel 前缀，MessageRow 渲染时按 i18n key 翻译
        { role: "assistant", content: `${REQUEST_FAILED_PREFIX}${String(e)}` },
      ]);
    } finally {
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
    <div className="flex h-full min-h-0 flex-col">
      {/* 消息列表 */}
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-2">
        {messages.length === 0 && !needConfig && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <HugeiconsIcon icon={AiChat02Icon} strokeWidth={1.5} className="size-10 opacity-60" />
            <p className="text-sm">{t("chat.emptyHint", { projectName })}</p>
          </div>
        )}

        {messages.map((m, i) => (
          <MessageRow
            key={i}
            message={m}
            isStreaming={i === messages.length - 1 && loading}
          />
        ))}
      </div>

      {/* 未配置密钥引导卡片 */}
      {needConfig && (
        <div className="mx-1 mb-2 rounded-xl border border-border bg-card p-4 text-sm">
          <p className="text-foreground">{t("chat.noConfigTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("chat.noConfigDesc")}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/settings")}>
            {t("chat.goSettings")}
          </Button>
        </div>
      )}

      {/* 工具行：上下文开关 + 工具模式 + 清空对话 */}
      <div className="flex shrink-0 items-start justify-between gap-2 px-1 pt-2">
        <div className="flex flex-col gap-1">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includeContext}
              onChange={(e) => setIncludeContext(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input accent-primary"
            />
            {t("chat.includeContext")}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={useTools}
              onChange={(e) => setUseTools(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input accent-primary"
            />
            {t("chat.toolMode")}
          </label>
          {isCli && useTools && (
            <p className="text-xs text-muted-foreground/70 pl-5">
              {t("chat.cliToolHint")}
            </p>
          )}
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            onClick={clearConversation}
            disabled={loading}
            className="text-muted-foreground hover:text-destructive"
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            {t("chat.clear")}
          </Button>
        )}
      </div>

      {/* 输入区 */}
      <div className="flex shrink-0 items-end gap-2 border-t border-border pt-3">
        <div className="relative min-w-0 flex-1">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (promptInsert.onKeyDown(e)) return;
              onKeyDown(e);
            }}
            placeholder={t("chat.placeholder")}
            className="min-h-16 w-full"
            disabled={loading}
          />
          {promptInsert.overlay}
        </div>
        {promptInsert.button}
        {loading ? (
          useTools ? (
            // 工具模式为非流式 agent loop，不可中途取消
            <Button variant="outline" disabled>
              {t("chat.running")}
            </Button>
          ) : (
            <Button variant="outline" onClick={handleStop}>
              {t("chat.stop")}
            </Button>
          )
        ) : (
          <Button onClick={() => void send()} disabled={!input.trim()}>
            <HugeiconsIcon icon={SentIcon} strokeWidth={2} />
            {t("chat.send")}
          </Button>
        )}
      </div>
    </div>
  );
}
