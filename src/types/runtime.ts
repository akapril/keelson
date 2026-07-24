// 进程条目类型（对应进程管理内核返回的 ProcessEntry + 运行时增补）。
export interface RuntimeProcess {
  id: string;
  name: string;
  command: string;
  cwd: string;
  pid: number;
  port: number[];
  status: string; // "running" | "stopped" | "exited"
  started_at: string;
  health?: string; // healthy | unhealthy | unknown
  /** 起自哪次 CLI 会话（intercept 自动托管时记；手动启动为空） */
  session_id?: string | null;
  /** 会话 provider（claude / codex），配合 session_id 跳转 */
  provider?: string | null;
  /** running 时附带的实时资源（cpu/mem 结构不定，按需读） */
  resources?: Record<string, unknown> | null;
}

/** 一条日志（daemon logs 返回）。字段随 claude-runtime 版本，按存在取用。 */
export interface RuntimeLog {
  timestamp?: string;
  level?: string;
  stream?: string;
  raw?: string;
  message?: string;
}
