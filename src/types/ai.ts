// AI 对话相关类型（字段与 Rust commands/ai.rs 的 serde 结构对齐，snake_case）。
export type AiProvider = "openai" | "anthropic";

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

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: "openai",
  base_url: "",
  api_key: "",
  model: "gpt-4o-mini",
};
