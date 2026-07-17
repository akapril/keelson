// RAG 相关类型（对应 Rust rag::{EmbedConfig, RagHit}）。
export interface EmbedConfig {
  provider: string; // "api" | "local" | "mock"
  base_url: string;
  api_key: string;
  model: string;
}

export interface RagHit {
  session_id: string;
  provider: string;
  role: string;
  snippet: string;
  score: number;
}

export const DEFAULT_EMBED_CONFIG: EmbedConfig = {
  provider: "mock",
  base_url: "",
  api_key: "",
  model: "text-embedding-3-small",
};
