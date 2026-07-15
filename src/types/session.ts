// Task 17: 会话相关的 TypeScript 类型，镜像 Rust 结构体（Task 8/13）

/** 单条会话记录（对应 Rust Session 结构） */
export interface Session {
  id: string;
  provider: string;
  project_path: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  summary?: string;
}

/** 搜索命中条目（对应 Rust SessionHit 结构） */
export interface SessionHit {
  session: Session;
  score: number;
  snippet?: string;
}

/** 会话时间线中的单条消息（对应 Rust TimelineMessage 结构） */
export interface TimelineMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}
