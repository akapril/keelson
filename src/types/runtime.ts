// claude-runtime 进程条目类型（对应 daemon ps 返回的 ProcessEntry + 运行时增补）。
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
  /** running 时 daemon 附带的实时资源（cpu/mem 结构不定，按需读） */
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
