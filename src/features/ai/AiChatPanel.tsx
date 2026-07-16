// AiChatPanel —— 项目级 AI 对话面板（流式 + 可选项目上下文/RAG）。
// 消息仅本地内存（不持久化，YAGNI）；流式经 ipc.aiChatStream 逐块渲染。
// 「包含项目上下文」开启后，注入本项目的文档 + 关联会话作为参考资料。
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { SentIcon, AiChat02Icon, Delete02Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSettingsStore } from "@/store/settings";
import { ipc } from "@/lib/tauri/ipc";
import type { AiChatMessage } from "@/types/ai";
import { buildProjectContext } from "./project-context";

interface AiChatPanelProps {
  projectId: string;
  projectName: string;
  repoPath?: string;
}

export function AiChatPanel({ projectId, projectName, repoPath }: AiChatPanelProps) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [needConfig, setNeedConfig] = useState(false);
  // 是否把项目文档+会话注入为上下文（RAG）
  const [includeContext, setIncludeContext] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // 本地持久化 key（按项目隔离）
  const storeKey = `rework-ai-chat-${projectId}`;

  // 切换项目时载入该项目已保存的对话历史
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      setMessages(raw ? (JSON.parse(raw) as AiChatMessage[]) : []);
    } catch {
      setMessages([]);
    }
    // 仅在项目切换时载入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // 每轮对话结束后（非流式中）持久化历史；空则清除
  useEffect(() => {
    if (loading) return;
    try {
      if (messages.length > 0) {
        localStorage.setItem(storeKey, JSON.stringify(messages));
      } else {
        localStorage.removeItem(storeKey);
      }
    } catch {
      /* localStorage 不可用时忽略 */
    }
  }, [loading, messages, storeKey]);

  // 清空当前项目对话
  const clearConversation = () => {
    setMessages([]);
    try {
      localStorage.removeItem(storeKey);
    } catch {
      /* ignore */
    }
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
    if (!aiConfig.api_key) {
      setNeedConfig(true);
      return;
    }
    setNeedConfig(false);

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
        const ctx = await buildProjectContext(projectId, repoPath);
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
    reqMsgs.push(...history, userMsg);

    try {
      await ipc.aiChatStream(aiConfig, reqMsgs, (ev) => {
        if (ev.kind === "delta" && ev.text) {
          updateAssistant((c) => c + ev.text);
        } else if (ev.kind === "error") {
          updateAssistant(() => `请求失败：${ev.text ?? ""}`);
        }
      });
      // 结束时助手仍为空 → 给个占位
      updateAssistant((c) => (c === "" ? "（无回复）" : c));
    } catch (e) {
      updateAssistant(() => `请求失败：${String(e)}`);
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
            <p className="text-sm">向「{projectName}」项目的 AI 助手提问吧</p>
          </div>
        )}

        {messages.map((m, i) => {
          const isUser = m.role === "user";
          const isError =
            m.role === "assistant" && m.content.startsWith("请求失败：");
          const isLast = i === messages.length - 1;
          // 流式中最后一条空助手气泡显示光标
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

      {/* 未配置密钥引导卡片 */}
      {needConfig && (
        <div className="mx-1 mb-2 rounded-xl border border-border bg-card p-4 text-sm">
          <p className="text-foreground">尚未配置 AI 服务</p>
          <p className="mt-1 text-xs text-muted-foreground">
            前往设置页填写 API Key 后即可与项目 AI 助手对话。
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/settings")}>
            去设置
          </Button>
        </div>
      )}

      {/* 工具行：上下文开关 + 清空对话 */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-1 pt-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeContext}
            onChange={(e) => setIncludeContext(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-input accent-primary"
          />
          包含项目上下文（文档 + 关联会话）
        </label>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            onClick={clearConversation}
            disabled={loading}
            className="text-muted-foreground hover:text-destructive"
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            清空
          </Button>
        )}
      </div>

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
        <Button onClick={() => void send()} disabled={loading || !input.trim()}>
          <HugeiconsIcon icon={SentIcon} strokeWidth={2} />
          发送
        </Button>
      </div>
    </div>
  );
}
