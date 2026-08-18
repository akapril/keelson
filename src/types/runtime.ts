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
  /** 交互式 PTY 进程（sudo 等）：右侧渲染可输入终端而非只读日志 */
  interactive?: boolean;
  /** 显示名（用户可改）：空则回退用 name。仅影响展示，name 仍为操作身份键 */
  label?: string | null;
  /** 备注/描述：说明该命令作用，用户可编辑 */
  note?: string | null;
}

/** 一条日志（进程管理内核 logs 返回）。字段按存在取用。 */
export interface RuntimeLog {
  timestamp?: string;
  level?: string;
  stream?: string;
  raw?: string;
  message?: string;
}

/** 「本地运行时」聚合状态（对齐 Rust RuntimeStatus）。 */
export interface RuntimeStatus {
  cpu_percent: number;
  mem_used: number;
  mem_total: number;
  mem_display: string;
  agent_running: number;
  agent_cap: number;
  uptime_secs: number;
  disk_bytes: number;
  disk_display: string;
  pb_ok: boolean;
  proc_count: number;
}
