// 文内 AI 桥接：把 rework 的 push 式流式对话(ipc.aiChatStream)桥接成 Crepe AI 特性
// 需要的 provider —— (context, signal) => AsyncIterable<string>。
// 编辑器选中文本 + 指令 → 组织 prompt → 流式增量 yield；signal.abort → 取消后端流。
import { ipc } from "@/lib/tauri/ipc";
import { useSettingsStore } from "@/store/settings";
import type { AiConfig } from "@/types/ai";
import type { AIProvider } from "@milkdown/crepe/feature/ai";

/** AI 是否可用：云服务商需 api_key；本地 CLI(claude/codex)无需 key。 */
export function aiConfigUsable(cfg: AiConfig): boolean {
  if (cfg.provider === "claude-cli" || cfg.provider === "codex-cli") return true;
  return !!cfg.api_key;
}

/**
 * 构造文档编辑器用的 Crepe AI provider。
 * 关键：每次调用时读「最新」AI 配置（getState，不捕获旧值），避免设置改了仍用旧配置。
 * 用「队列 + 唤醒」把 channel 回调(push)转成生成器(pull)，signal 中止时取消后端流并结束。
 */
export function createDocAiProvider(): AIProvider {
  return async function* (context, signal) {
    const config = useSettingsStore.getState().aiConfig;
    const system =
      "你是嵌入 Markdown 编辑器的写作助手。直接输出改写/续写后的 Markdown 片段本身：" +
      "不要解释、不要加代码围栏、不要复述指令。";
    const user = [
      context.selection
        ? `【选中片段】\n${context.selection}`
        : "【无选中：请针对光标处续写或按指令生成】",
      context.document
        ? `\n\n【文档上下文（截断）】\n${context.document.slice(0, 4000)}`
        : "",
      `\n\n【指令】\n${context.instruction}`,
    ].join("");
    const messages = [
      { role: "system" as const, content: system },
      { role: "user" as const, content: user },
    ];
    const streamId = `doc-ai-${Date.now()}`;

    // 桥接缓冲：channel 回调 push 到 queue，生成器循环 pull；done/err 由回调置位。
    const queue: string[] = [];
    let done = false;
    let err: string | null = null;
    let wake: (() => void) | null = null;
    const notify = () => {
      const w = wake;
      wake = null;
      w?.();
    };

    const onAbort = () => {
      void ipc.aiCancelStream(streamId).catch(() => {});
      done = true;
      notify();
    };
    signal.addEventListener("abort", onAbort);

    // 启动后端流式对话（增量经 channel 回调回来）
    void ipc
      .aiChatStream(config, messages, streamId, (ev) => {
        if (ev.kind === "delta" && ev.text) queue.push(ev.text);
        else if (ev.kind === "error") {
          err = ev.text || "生成失败";
          done = true;
        } else if (ev.kind === "done") {
          done = true;
        }
        notify();
      })
      .catch((e) => {
        err = String(e);
        done = true;
        notify();
      });

    try {
      while (true) {
        if (queue.length) {
          yield queue.shift() as string;
          continue;
        }
        if (done) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (err) throw new Error(err);
  };
}
