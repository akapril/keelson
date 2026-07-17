// AI 对话相关类型（字段与 Rust commands/ai.rs 的 serde 结构对齐，snake_case）。
export type AiProvider = "openai" | "anthropic" | "claude-cli" | "codex-cli";

export interface AiConfig {
  provider: AiProvider;
  /** 接口 base URL，留空则用官方默认（OpenAI: api.openai.com/v1；Anthropic: api.anthropic.com） */
  base_url: string;
  api_key: string;
  model: string;
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 流式对话事件（后端经 Tauri Channel 推送）。 */
export interface AiStreamEvent {
  kind: "delta" | "done" | "error";
  text: string | null;
}

// ── 工具调用（agent loop）——与 Rust commands/ai.rs 的 serde 结构对齐 ──

/** 一次工具调用（arguments 为 JSON 字符串）。 */
export interface AiToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** 工具对话消息（支持 assistant.tool_calls 与 tool 结果跨轮传递）。 */
export interface ToolChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  /** assistant 发起的工具调用 */
  tool_calls?: AiToolCall[];
  /** tool 结果对应的调用 id */
  tool_call_id?: string | null;
}

/** 模型一轮输出：最终文本或一批待执行工具调用。 */
export interface AiToolTurn {
  kind: "text" | "tool_calls";
  content: string | null;
  tool_calls: AiToolCall[];
}

/** 中性工具定义（{name,description,parameters(JSON schema)}，Rust 侧按 provider 转换）。 */
export interface AiToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: "openai",
  base_url: "",
  api_key: "",
  model: "gpt-4o-mini",
};
