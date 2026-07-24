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

/** 进程管理 daemon 一次性体检结果（对应 Rust RuntimeDiag）。 */
export interface RuntimeDiag {
  /** daemon(:19191) 是否可连接 */
  daemon_running: boolean;
  /** 运行中的 daemon 是否为 rework 进程内那个（否则为外部 claude-runtime CLI 的） */
  embedded: boolean;
  /** 当前托管的进程数 */
  process_count: number;
}

/** 一条日志（daemon logs 返回）。字段随 claude-runtime 版本，按存在取用。 */
export interface RuntimeLog {
  timestamp?: string;
  level?: string;
  stream?: string;
  raw?: string;
  message?: string;
}
