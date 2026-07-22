// Task 17/18 修正：TypeScript 类型严格镜像 Rust serde 序列化输出（默认 snake_case）

/** 单条会话记录（对应 Rust Session 结构体，serde 默认 snake_case） */
export interface Session {
  /** 会话唯一标识符 */
  session_id: string;
  /** provider 名称，如 "claude" / "codex" */
  provider: string;
  /** 项目所在目录的绝对路径 */
  project_path: string;
  /** 项目名称（通常为目录名） */
  project_name: string;
  /** 会话的第一条用户提示词 */
  first_prompt: string;
  /** 会话的最后一条用户提示词 */
  last_prompt: string;
  /** 会话创建时间（RFC3339 字符串，由 chrono DateTime<Utc> 序列化） */
  created_at: string;
  /** 会话最后更新时间（RFC3339 字符串） */
  updated_at: string;
  /** 会话消息总数（含 user + assistant） */
  message_count: number;
  /** 所有用户消息列表（用于全文检索） */
  user_messages: string[];
  /** 总 token 数 */
  total_tokens: number;
  /** 按模型的 token 归因（模型名 → token；Σ == total_tokens）。旧数据/未解析时可能缺省 */
  by_model?: Record<string, number>;
}

/** 搜索命中条目（对应 Rust SessionHit 结构体，扁平结构） */
export interface SessionHit {
  /** 会话唯一标识符 */
  session_id: string;
  /** 项目名称 */
  project_name: string;
  /** 搜索结果片段（当前使用 first_prompt 作为摘要） */
  snippet: string;
  /** provider 名称 */
  provider: string;
  /** 更新时间（格式化字符串，如 "07-15 14:30"） */
  updated_at: string;
  /** Tantivy 相关性评分 */
  score: number;
}

/** 会话「规划的任务」（Claude TaskCreate/TaskUpdate 落盘状态，对应 Rust PlannedTask） */
export interface PlannedTask {
  /** 任务序号 id（"1"/"2"/…） */
  id: string;
  /** 标题 */
  subject: string;
  /** 描述 */
  description: string;
  /** 状态：pending | in_progress | completed */
  status: string;
}

/** 会话时间线中的单条消息（对应 Rust TimelineMessage 结构体） */
export interface TimelineMessage {
  /** 消息角色 */
  role: "user" | "assistant" | "system";
  /** 消息内容文本 */
  content: string;
  /** ISO 8601 格式的消息时间戳（Rust 为非 Option，必填） */
  timestamp: string;
}
