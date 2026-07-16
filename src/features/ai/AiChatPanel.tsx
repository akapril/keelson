// AiChatPanel —— 项目级 AI 对话面板。
// 非流式对话：本地维护消息列表（不持久化，YAGNI），通过 ipc.aiChat 调用后端。
// 未配置密钥时展示引导卡片，指引用户前往设置页配置 AI 服务。
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { SentIcon, AiChat02Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSettingsStore } from "@/store/settings";
import { ipc } from "@/lib/tauri/ipc";
import type { AiChatMessage } from "@/types/ai";

export function AiChatPanel({ projectName }: { projectName: string }) {
  const navigate = useNavigate();
  // 会话消息（仅本地内存，切换项目/刷新即丢弃）
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // 未配置密钥的引导提示（本地控制，避免误发请求）
  const [needConfig, setNeedConfig] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // 发送后滚动到底部
  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    // 每次发送时读取最新 AI 配置（另一个 store 字段可能被并发更新）
    const aiConfig = useSettingsStore.getState().aiConfig;
    if (!aiConfig.api_key) {
      // 未配置密钥：展示引导卡片，不调用接口
      setNeedConfig(true);
      return;
    }
    setNeedConfig(false);

    // 系统提示：绑定当前项目上下文，要求简洁中文回答
    const system: AiChatMessage = {
      role: "system",
      content: `你是「${projectName}」项目的 AI 助手，用简洁中文回答。`,
    };
    const userMsg: AiChatMessage = { role: "user", content: text };
    // 先在本地追加用户消息并清空输入框
    const history = messages;
    setMessages([...history, userMsg]);
    setInput("");
    setLoading(true);
    scrollToBottom();

    try {
      // system 不进入展示列表，仅作为请求上下文的首条消息
      const reply = await ipc.aiChat(aiConfig, [system, ...history, userMsg]);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      // 出错时保留用户消息，并以助手消息形式内联展示错误（destructive 样式）
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `请求失败：${String(e)}` },
      ]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  };

  // Enter 发送，Shift+Enter 换行
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 消息列表（可滚动） */}
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-2">
        {messages.length === 0 && !needConfig && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <HugeiconsIcon icon={AiChat02Icon} strokeWidth={1.5} className="size-10 opacity-60" />
            <p className="text-sm">
              向「{projectName}」项目的 AI 助手提问吧
            </p>
          </div>
        )}

        {messages.map((m, i) => {
          const isUser = m.role === "user";
          const isError = m.role === "assistant" && m.content.startsWith("请求失败：");
          return (
            <div
              key={i}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  isUser
                    ? "bg-primary/10 text-foreground"
                    : isError
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-foreground"
                }`}
              >
                {m.content}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
              思考中…
            </div>
          </div>
        )}
      </div>

      {/* 未配置密钥的引导卡片 */}
      {needConfig && (
        <div className="mx-1 mb-2 rounded-xl border border-border bg-card p-4 text-sm">
          <p className="text-foreground">尚未配置 AI 服务</p>
          <p className="mt-1 text-xs text-muted-foreground">
            前往设置页填写 API Key 后即可与项目 AI 助手对话。
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => navigate("/settings")}
          >
            去设置
          </Button>
        </div>
      )}

      {/* 底部输入区 */}
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
