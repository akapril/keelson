import { invoke, Channel } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/env";
import { handleAuthExpired } from "@/web/auth-expiry";
import type { Session, SessionHit, TimelineMessage, PlannedTask } from "../../types/session";
import type { EmbedConfig, RagHit } from "@/types/rag";
import type { CommitInfo, CorrelatedCommit, HookStatus } from "@/types/git";
import type { MemFilesStatus, FileMemory } from "@/types/memory";
import type { RuntimeProcess, RuntimeLog, RuntimeStatus } from "@/types/runtime";
import type { FileChange } from "@/types/file-change";
import type {
  AiConfig,
  AiChatMessage,
  AiStreamEvent,
  ToolChatMessage,
  AiToolDef,
  AiToolTurn,
} from "../../types/ai";
/** 仓库内 markdown 文件项（「导入计划」对话框用；对应 Rust MdFile） */
export interface MdFile {
  name: string;
  path: string;
}

/**
 * 双通道内部 helper：
 * - Tauri 环境：直接调 invoke<T>(cmd, args)（原生 IPC）。
 * - Web 环境：POST /api/<cmd>，携带 credentials: "same-origin"（复用 kln_token cookie）。
 *   web 端未实现的 endpoint 会抛（404），对应 UI 不渲染即可。
 *
 * 唯一允许出现 invoke 字符串命令名的地方。新增本地能力只加一个 ipc.* 方法。
 */
function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    return invoke<T>(cmd, args);
  }
  // web 环境：走 gateway /api/<cmd>（POST + JSON body）
  return fetch(`/api/${cmd}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(args ?? {}),
  }).then((r) => {
    // 认证过期（重启后 token 失效/被吊销）：引导重新配对，而非停在「加载失败」。
    if (r.status === 401) {
      handleAuthExpired();
      throw new Error(`${cmd} 401`);
    }
    if (!r.ok) throw new Error(`${cmd} ${r.status}`);
    return r.json() as Promise<T>;
  });
}

/**
 * runtime_command 统一调用：进程内核约定**失败返回 `{error: string}`**（而非抛异常/HTTP 错误码）。
 * 此处把带 error 的返回转成 throw，让调用方 try/catch 拿到真实原因（如"名称正在运行"/"无法启动"），
 * 避免"后端失败、前端却弹成功"。数组返回（ps/logs）不含 error，原样透传。
 */
async function runtimeCmd<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const res = await call<T>("runtime_command", { cmd, args });
  if (res && typeof res === "object" && !Array.isArray(res)) {
    const err = (res as { error?: unknown }).error;
    if (err) throw new Error(String(err));
  }
  return res;
}

// 唯一允许出现 invoke 字符串命令名的地方。新增本地能力只加一个方法。
export const ipc = {
  ping: () => call<string>("ping"),

  /** 将文本写入指定绝对路径（导出「另存为」用；配合 dialog.save 取路径） */
  writeTextFile: (path: string, content: string) =>
    call<void>("write_text_file", { path, content }),

  /** 在系统文件管理器中打开路径（会话中枢 / 项目工作台「打开位置」） */
  openPath: (path: string) => call<void>("open_path", { path }),

  /** 获取 PocketBase 数据目录绝对路径（设置页「打开数据目录」） */
  pbDataDir: () => call<string>("pb_data_dir"),

  /** 读文本文件（「导入计划」解析计划/spec 用） */
  readTextFile: (path: string) => call<string>("read_text_file", { path }),
  /** 列目录下 .md 文件（「导入计划」列计划目录用；目录不存在返回空） */
  listMarkdownFiles: (dir: string) => call<MdFile[]>("list_markdown_files", { dir }),

  /** Spotlight 打开任务/文档：聚焦主窗 + 广播导航事件 + 隐藏 spotlight（后端处理） */
  spotlightOpen: (path: string) => call<void>("spotlight_open", { path }),

  // ── MCP 一键接入（把 rework MCP 写入 claude / codex 配置） ──────────
  /** 获取当前 MCP 端点 url（供设置页展示；secret 不再下发前端） */
  mcpEndpoint: () => call<{ url: string }>("mcp_endpoint"),
  /** 一键接入 Claude Code（写 ~/.claude.json 的 mcpServers.rework） */
  mcpInstallClaude: () => call<string>("mcp_install_claude"),
  /** 一键接入 Codex（写 ~/.codex/config.toml 的 [mcp_servers.rework]） */
  mcpInstallCodex: () => call<string>("mcp_install_codex"),

  /** 抓取 URL 并返回粗提取的可读正文（阅读「AI 解析」用） */
  fetchUrlText: (url: string) => call<string>("fetch_url_text", { url }),

  // ── Web Gateway（外网访问）────────────────────────────────────
  /** 启动 Web Gateway（幂等；已运行则返回现有端口） */
  webGatewayStart: () => call<number>("web_gateway_start"),
  /** 停止 Web Gateway（未运行则静默成功） */
  webGatewayStop: () => call<void>("web_gateway_stop"),
  /** 查询 Web Gateway 状态：运行中返回端口号，未运行返回 null */
  webGatewayStatus: () => call<number | null>("web_gateway_status"),
  /** 读取当前配对码（仅本机 UI 调用；切勿记录到日志/外传） */
  webPairingCode: () => call<string>("web_pairing_code"),
  /** 手动轮换配对码：作废旧码并返回新码（用于换新设备配对或作废泄露码） */
  webRegeneratePairingCode: () => call<string>("web_regenerate_pairing_code"),
  /** 列出已配对设备（脱敏：仅含 id / label / paired_at，不含 token） */
  webListDevices: () => call<Array<{ id: string; label: string; paired_at: string }>>("web_list_devices"),
  /** 吊销指定设备（id 不存在时幂等 no-op） */
  webRevokeDevice: (id: string) => call<void>("web_revoke_device", { id }),
  /** 重命名已配对设备的展示名（空名报错；过长截断 60 字符） */
  webRenameDevice: (id: string, label: string) => call<void>("web_rename_device", { id, label }),

  // ── 会话列表 ──────────────────────────────────────────────
  /** 获取所有本地会话（Task 17） */
  listSessions: () => call<Session[]>("sessions_list"),

  /** 全文搜索会话（Tantivy 后端，覆盖全部用户消息，按相关度排序） */
  searchSessions: (q: string) => call<SessionHit[]>("sessions_search", { query: q }),

  /** 获取指定会话的时间线消息（Task 17）
   *  注意：Tauri v2 默认前端传 camelCase，自动映射到 Rust 的 snake_case 形参。 */
  sessionTimeline: (provider: string, id: string) =>
    call<TimelineMessage[]>("sessions_timeline", { provider, sessionId: id }),

  /** 获取所有项目路径（Task 17） */
  projectPaths: () => call<string[]>("sessions_project_paths"),

  /** 恢复/打开一个会话终端（Task 17）
   *  注意：Tauri v2 默认前端传 camelCase（projectPath/sessionId/asTab），自动映射到 snake_case 形参。 */
  restore: (provider: string, projectPath: string, id: string, asTab: boolean) =>
    call<void>("terminal_resume", {
      provider,
      projectPath,
      sessionId: id,
      asTab,
    }),

  /** 在项目目录新建一个 CLI 会话（就地起 claude/codex，跑后写盘即出现在会话 tab）。initialPrompt 可选 */
  startSession: (provider: string, projectPath: string, initialPrompt?: string) =>
    call<void>("terminal_start", { provider, projectPath, initialPrompt }),

  /** 在项目目录打开一个纯终端（不起任何 CLI，仅 cd 到项目目录）。 */
  openTerminal: (projectPath: string) =>
    call<void>("terminal_open", { projectPath }),

  /** 列出「能起新会话」的 provider（其 CLI 二进制在 PATH）。桌面专属，web 环境 404 → 前端回退空列表。 */
  listStartableProviders: () =>
    call<{ id: string; label: string }[]>("list_startable_providers"),

  // ── 配置 ──────────────────────────────────────────────────
  /** 获取全局快捷键配置（Task 17） */
  getHotkey: () => call<string>("config_get_hotkey"),

  /** 保存全局快捷键配置（Task 17） */
  setHotkey: (hotkey: string) => call<void>("config_set_hotkey", { hotkey }),

  /** 读取「退出时如何处理受管进程」设置（"keep"/"kill"/"ask"） */
  getExitBehavior: () => call<string>("config_get_exit_behavior"),
  /** 保存「退出时如何处理受管进程」设置 */
  setExitBehavior: (behavior: string) => call<void>("config_set_exit_behavior", { behavior }),
  /** 退出应用（供退出确认弹窗调用）：killProcesses=true 先结束所有受管进程 */
  exitApp: (killProcesses: boolean) => call<void>("exit_app", { killProcesses }),

  // ── 系统与维护（桌面专属） ──────────
  /** 是否已开启开机自启 */
  autostartGet: () => call<boolean>("autostart_get"),
  /** 设置开机自启开关 */
  autostartSet: (enabled: boolean) => call<void>("autostart_set", { enabled }),
  /** PB 存储占用（pb_data 总大小 / 日志库 / 主数据库，字节）+ 当前保留天数 */
  pbStorageInfo: () =>
    call<{ pb_data_bytes: number; logs_bytes: number; data_bytes: number; retention_days: number }>(
      "pb_storage_info",
    ),
  /** 设置 PB 日志保留天数（1..365；下次启动生效） */
  setLogRetention: (days: number) => call<void>("set_log_retention", { days }),
  /** 标记下次启动清空 PB 日志库（回收磁盘） */
  clearPbLogs: () => call<void>("clear_pb_logs"),

  // ── Board / retalk 集成 ────────────────────────────────────
  /** 读取本地仓库的当前分支与未提交变更数（Task 13，包装 git_info 命令） */
  gitInfo: (path: string) =>
    call<{ branch: string | null; dirty_count: number; is_repo: boolean }>("git_info", { path }),

  /** 读取仓库指定时间窗的提交（会话→Commit 溯源）；非仓库/失败返回空数组 */
  gitLog: (path: string, since: string | null, until: string | null, limit: number) =>
    call<CommitInfo[]>("git_log", { path, since, until, limit }),

  /** 返回与某会话关联的提交（trailer 精确 / 时间窗可能相关）。判据在 Rust 单点。 */
  sessionCommits: (sessionId: string, provider: string) =>
    call<CorrelatedCommit[]>("session_commits", { sessionId, provider }),

  /** 返回会话改动的文件（从转录 Write/Edit/MultiEdit 还原，含未提交改动）。v1 仅 Claude。 */
  sessionFileChanges: (provider: string, sessionId: string) =>
    call<FileChange[]>("session_file_changes", { provider, sessionId }),

  /** 返回会话「规划的任务」（Claude TaskCreate/TaskUpdate 落盘状态），供同步到看板。v1 仅 Claude。 */
  sessionTasks: (provider: string, sessionId: string) =>
    call<PlannedTask[]>("session_tasks", { provider, sessionId }),

  // ── 会话溯源 git 钩子（Phase 2） ──────────────────────────
  /** 查询某仓库的会话溯源钩子状态 */
  sessionHookStatus: (path: string) => call<HookStatus>("session_hook_status", { path }),
  /** 在某仓库启用会话溯源（安装 prepare-commit-msg 钩子，幂等、与他人钩子共存） */
  installSessionTrailerHook: (path: string) =>
    call<void>("install_session_trailer_hook", { path }),
  /** 停用（移除 rework 的钩子标记块 + marker） */
  uninstallSessionTrailerHook: (path: string) =>
    call<void>("uninstall_session_trailer_hook", { path }),

  // ── 实时活动 hook（Phase 2：Claude Code PostToolUse 全量工具流） ──────
  /** 查询 rework 实时活动 hook 状态（是否安装 + 是否当前版本；up_to_date=false 表示装了但过期需升级） */
  activityHookStatus: () =>
    call<{ installed: boolean; up_to_date: boolean }>("activity_hook_status"),
  /** 安装实时活动 hook（写 ~/.claude/settings.json 的 PostToolUse，幂等、保留用户其它设置） */
  installActivityHook: () => call<void>("install_activity_hook"),
  /** 卸载实时活动 hook（只移除 rework 自己那一条） */
  uninstallActivityHook: () => call<void>("uninstall_activity_hook"),

  // ── 进程拦截 hook（PreToolUse(Bash) 长驻进程自动托管） ──────
  /** 查询进程拦截 hook 是否已安装 */
  interceptHookStatus: () => call<boolean>("intercept_hook_status"),
  /** 安装拦截 hook（写 ~/.claude/settings.json 的 PreToolUse(Bash)，幂等、保留用户其它设置） */
  installInterceptHook: () => call<void>("install_intercept_hook"),
  /** 卸载拦截 hook（只移除 rework 自己那一条） */
  uninstallInterceptHook: () => call<void>("uninstall_intercept_hook"),

  // ── AI 对话（provider 可切；包装 ai_chat 命令） ────────────
  /** 非流式对话：返回助手回复文本。cwd=项目仓库路径（可选），CLI provider 在该目录下运行。 */
  aiChat: (config: AiConfig, messages: AiChatMessage[], cwd?: string) =>
    call<string>("ai_chat", { config, messages, cwd }),

  /** 一轮工具对话：返回「最终文本」或「待执行工具调用」（agent loop 由前端驱动） */
  aiChatTools: (
    config: AiConfig,
    messages: ToolChatMessage[],
    tools: AiToolDef[],
  ) => call<AiToolTurn>("ai_chat_tools", { config, messages, tools }),

  /** 流式对话：经 Tauri Channel 实时回调增量事件；Promise 在结束时 resolve。
   *  streamId 用于「停止生成」（调 aiCancelStream 同一 id）。
   *  ⚠️ 此方法依赖 Tauri Channel（仅 Tauri 原生可用），web 环境不支持，调用会抛。 */
  aiChatStream: (
    config: AiConfig,
    messages: AiChatMessage[],
    streamId: string,
    onEvent: (ev: AiStreamEvent) => void,
    withTools = false,
    cwd?: string,
  ) => {
    // Channel 是 Tauri 原生对象，web 环境无法使用；保留原始 invoke（不走 call）。
    const channel = new Channel<AiStreamEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("ai_chat_stream", {
      config,
      messages,
      streamId,
      onEvent: channel,
      withTools,
      cwd,
    });
  },

  /** 取消进行中的流式对话（停止生成）。 */
  aiCancelStream: (streamId: string) =>
    call<void>("ai_cancel_stream", { streamId }),

  /** 拉取服务商可用模型 id 列表；本地 CLI 返回空数组，失败时 reject（前端回退手填）。 */
  listModels: (config: AiConfig) =>
    call<string[]>("list_models", { config }),

  // ── RAG 语义检索 ───────────────────────────────────────────
  /** 语义召回：返回与 query 最相似的历史会话片段列表（limit 默认 8） */
  ragSearch: (config: EmbedConfig, query: string, limit: number) =>
    call<RagHit[]>("rag_search", { config, query, limit }),

  /** 为全量历史会话建嵌入索引；返回已索引的消息数 */
  ragBuildIndex: (config: EmbedConfig) =>
    call<number>("rag_build_index", { config }),

  // 通用文本嵌入（记忆语义去重用）
  embedTexts: (config: EmbedConfig, texts: string[]) =>
    call<number[][]>("embed_texts", { config, texts }),

  // 记忆注入项目文件
  memoryWriteProjectFiles: (
    repoPath: string,
    mems: { content: string; kind: string; scope: string }[],
  ) => call<string[]>("memory_write_project_files", { repoPath, mems }),
  memoryProjectFilesStatus: (repoPath: string) =>
    call<MemFilesStatus>("memory_project_files_status", { repoPath }),

  /** 把看板任务写进 <repo>/CLAUDE.md+AGENTS.md 的 rework-tasks 受管块（看板→CLI 注入）。空 tasks=卸载 */
  tasksWriteProjectFiles: (
    repoPath: string,
    tasks: { title: string; done: boolean; hint: string }[],
  ) => call<string[]>("tasks_write_project_files", { repoPath, tasks }),

  /** 查任务注入状态（两文件是否含块 + 块内任务条数），供看板常驻显示 */
  tasksProjectFilesStatus: (repoPath: string) =>
    call<{ claude_md: boolean; agents_md: boolean; count: number }>(
      "tasks_project_files_status",
      { repoPath },
    ),

  /** 扫描 Claude 文件记忆（各项目 memory 目录下的 .md），供记忆桥导入记忆账本 */
  scanFileMemories: () => call<FileMemory[]>("scan_file_memories"),

  // ── 进程管理（进程内模块，命令直调；项目「进程」tab + 侧边栏「进程」页） ──────
  /** 进程列表（project 为空=全部；非空=按 cwd 含 project 过滤） */
  runtimePs: (project: string) => runtimeCmd<RuntimeProcess[]>("ps", { project }),
  /** 某进程的日志（最近 limit 条） */
  runtimeLogs: (name: string, limit: number) =>
    runtimeCmd<RuntimeLog[]>("logs", { name, limit }),
  /** 清空某进程的日志文件（截断为 0，不删；进程在跑也可清） */
  runtimeClearLogs: (name: string) => runtimeCmd<unknown>("clear_logs", { name }),
  /** 用系统默认程序打开某进程的日志文件（查看全量） */
  runtimeOpenLog: (name: string) => runtimeCmd<unknown>("open_log", { name }),
  /** 在项目目录启动新进程 */
  runtimeStart: (command: string, name: string, cwd: string) =>
    runtimeCmd<unknown>("start", { command, name, cwd }),
  /** 停止 / 重启进程 */
  runtimeStop: (name: string) => runtimeCmd<unknown>("stop", { name }),
  runtimeRestart: (name: string) => runtimeCmd<unknown>("restart", { name }),
  /** 删除一个已退出/停止的进程记录（连同其日志文件；running 的会被拒绝，需先停止） */
  runtimeRemove: (name: string) => runtimeCmd<unknown>("remove", { name }),
  /** 设置进程显示名(label)与备注(note)；空串=清除。按 name 定位，不改身份键。 */
  runtimeSetMeta: (name: string, label: string, note: string) =>
    runtimeCmd<unknown>("set_meta", { name, label, note }),
  /** 清理：移除所有已停止/退出的进程记录 + 删除超过 days 天的日志文件 */
  runtimeClean: (days: number) =>
    runtimeCmd<{ processes_removed: number; log_files_deleted: number }>("clean", { days }),
  /** 拉取本地运行时聚合状态（运行时卡轮询）。 */
  runtimeStatus: () => call<RuntimeStatus>("runtime_status"),

  // ── 交互式 PTY（桌面专属；直接 invoke，不走双通道） ──────────
  /** 交互式启动：跑 PTY，返回创建的进程条目（桌面专属） */
  runtimePtyStart: (command: string, name: string, cwd: string) =>
    invoke<RuntimeProcess>("runtime_pty_start", { command, name, cwd }),
  /** 向交互 PTY 写 stdin（键入/密码） */
  runtimePtyInput: (id: string, data: string) =>
    invoke<void>("runtime_pty_input", { id, data }),
  /** 调整交互 PTY 尺寸 */
  runtimePtyResize: (id: string, cols: number, rows: number) =>
    invoke<void>("runtime_pty_resize", { id, cols, rows }),
  /** 停止交互 PTY 会话（interactive 进程 pid=0，不能走 PID kill） */
  runtimePtyKill: (id: string) =>
    invoke<void>("runtime_pty_kill", { id }),

  // ── Agent 自主执行（看板任务 P1）────────────────────────────
  /** 在独立 worktree 运行 Agent；事件经 Channel 实时回调（桌面专属，web 环境会抛）。
   *  onEvent.kind: "delta" | "done"；done 时携带 run_id。*/
  agentRunTask: (
    taskId: string,
    agentRef: string,
    onEvent: (e: { kind: string; text?: string; run_id?: string }) => void,
  ) => {
    // Channel 是 Tauri 原生对象，不走 call() 双通道；与 aiChatStream 保持同一范式。
    // S2：参数键由 provider 改为 agentRef，对齐 Rust 命令形参 agent_ref（Task 3）。
    const ch = new Channel<{ kind: string; text?: string; run_id?: string }>();
    ch.onmessage = onEvent;
    return call<string>("agent_run_task", { taskId, agentRef, onEvent: ch });
  },

  /** 将指定 Agent 运行结果合并进主分支（审核通过后调用）。 */
  agentMergeRun: (runId: string) => call<void>("agent_merge_run", { runId }),

  /** 只读取指定 Agent 运行的完整改动 patch（供审阅步骤展示；无副作用）。 */
  agentRunDiff: (runId: string) => call<string>("agent_run_diff", { runId }),

  /** 丢弃指定 Agent 运行（保留 worktree 日志，状态置 discarded）。 */
  agentDiscardRun: (runId: string) => call<void>("agent_discard_run", { runId }),
};
