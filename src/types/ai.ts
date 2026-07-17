// AI 对话相关类型（字段与 Rust commands/ai.rs 的 serde 结构对齐，snake_case）。
export type AiProvider = "openai" | "anthropic" | "claude-cli" | "codex-cli";

export interface AiConfig {
  provider: AiProvider;
  /** 接口 base URL，留空则用官方默认（OpenAI: api.openai.com/v1；Anthropic: api.anthropic.com） */
  base_url: string;
  api_key: string;
  model: string;
  /** 本地 CLI 可执行文件绝对路径（可选）。填了则绕过 PATH 直接启动，解决 GUI 进程找不到 codex/claude 的问题。 */
  cli_path?: string;
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
  cli_path: "",
};

// ── 按服务商隔离的配置 ─────────────────────────────────────
// 每个服务商各自持久化一份字段（provider 本身除外），切换服务商时互不覆盖。

/** 单个服务商保存的字段（不含 provider）。 */
export interface AiProviderFields {
  base_url: string;
  api_key: string;
  model: string;
  cli_path?: string;
}

/** 各服务商的默认模型；本地 CLI 由自身决定模型，无需填写，故留空。 */
export const DEFAULT_MODEL_BY_PROVIDER: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-latest",
  "claude-cli": "",
  "codex-cli": "",
};

/** 构造某服务商的默认字段（模型预填官方默认，其余留空）。 */
export function defaultFieldsFor(provider: AiProvider): AiProviderFields {
  return {
    base_url: "",
    api_key: "",
    model: DEFAULT_MODEL_BY_PROVIDER[provider],
    cli_path: "",
  };
}
