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

/** claude-runtime 一次性体检结果（对应 Rust RuntimeDiag）。 */
export interface RuntimeDiag {
  /** PATH 中能否找到 claude-runtime 二进制 */
  binary_found: boolean;
  /** 二进制绝对路径（找不到则空） */
  binary_path: string;
  /** claude-runtime --version 输出（找不到则空） */
  version: string;
  /** daemon(:19191) 是否可连接 */
  daemon_running: boolean;
  /** Dashboard(:19192) 是否可连接 */
  dashboard_reachable: boolean;
}

/** 一条日志（daemon logs 返回）。字段随 claude-runtime 版本，按存在取用。 */
export interface RuntimeLog {
  timestamp?: string;
  level?: string;
  stream?: string;
  raw?: string;
  message?: string;
}
