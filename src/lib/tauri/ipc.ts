import { invoke, Channel } from "@tauri-apps/api/core";
import type { Session, SessionHit, TimelineMessage, PlannedTask } from "../../types/session";
import type { EmbedConfig, RagHit } from "@/types/rag";
import type { CommitInfo, CorrelatedCommit, HookStatus } from "@/types/git";
import type { MemFilesStatus, FileMemory } from "@/types/memory";
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

// 唯一允许出现 invoke 字符串命令名的地方。新增本地能力只加一个方法。
export const ipc = {
  ping: () => invoke<string>("ping"),

  /** 将文本写入指定绝对路径（导出「另存为」用；配合 dialog.save 取路径） */
  writeTextFile: (path: string, content: string) =>
    invoke<void>("write_text_file", { path, content }),

  /** 在系统文件管理器中打开路径（会话中枢 / 项目工作台「打开位置」） */
  openPath: (path: string) => invoke<void>("open_path", { path }),

  /** 获取 PocketBase 数据目录绝对路径（设置页「打开数据目录」） */
  pbDataDir: () => invoke<string>("pb_data_dir"),

  /** 读文本文件（「导入计划」解析计划/spec 用） */
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),
  /** 列目录下 .md 文件（「导入计划」列计划目录用；目录不存在返回空） */
  listMarkdownFiles: (dir: string) => invoke<MdFile[]>("list_markdown_files", { dir }),

  /** Spotlight 打开任务/文档：聚焦主窗 + 广播导航事件 + 隐藏 spotlight（后端处理） */
  spotlightOpen: (path: string) => invoke<void>("spotlight_open", { path }),

  // ── MCP 一键接入（把 rework MCP 写入 claude / codex 配置） ──────────
  /** 获取当前 MCP 端点（url + secret，供设置页展示） */
  mcpEndpoint: () => invoke<{ url: string; secret: string }>("mcp_endpoint"),
  /** 一键接入 Claude Code（写 ~/.claude.json 的 mcpServers.rework） */
  mcpInstallClaude: () => invoke<string>("mcp_install_claude"),
  /** 一键接入 Codex（写 ~/.codex/config.toml 的 [mcp_servers.rework]） */
  mcpInstallCodex: () => invoke<string>("mcp_install_codex"),

  /** 抓取 URL 并返回粗提取的可读正文（阅读「AI 解析」用） */
  fetchUrlText: (url: string) => invoke<string>("fetch_url_text", { url }),

  // ── 会话列表 ──────────────────────────────────────────────
  /** 获取所有本地会话（Task 17） */
  listSessions: () => invoke<Session[]>("sessions_list"),

  /** 全文搜索会话（Tantivy 后端，覆盖全部用户消息，按相关度排序） */
  searchSessions: (q: string) => invoke<SessionHit[]>("sessions_search", { query: q }),

  /** 获取指定会话的时间线消息（Task 17）
   *  注意：Tauri v2 默认前端传 camelCase，自动映射到 Rust 的 snake_case 形参。 */
  sessionTimeline: (provider: string, id: string) =>
    invoke<TimelineMessage[]>("sessions_timeline", { provider, sessionId: id }),

  /** 获取所有项目路径（Task 17） */
  projectPaths: () => invoke<string[]>("sessions_project_paths"),

  /** 恢复/打开一个会话终端（Task 17）
   *  注意：Tauri v2 默认前端传 camelCase（projectPath/sessionId/asTab），自动映射到 snake_case 形参。 */
  restore: (provider: string, projectPath: string, id: string, asTab: boolean) =>
    invoke<void>("terminal_resume", {
      provider,
      projectPath,
      sessionId: id,
      asTab,
    }),

  // ── 配置 ──────────────────────────────────────────────────
  /** 获取全局快捷键配置（Task 17） */
  getHotkey: () => invoke<string>("config_get_hotkey"),

  /** 保存全局快捷键配置（Task 17） */
  setHotkey: (hotkey: string) => invoke<void>("config_set_hotkey", { hotkey }),

  // ── Board / retalk 集成 ────────────────────────────────────
  /** 读取本地仓库的当前分支与未提交变更数（Task 13，包装 git_info 命令） */
  gitInfo: (path: string) =>
    invoke<{ branch: string | null; dirty_count: number; is_repo: boolean }>("git_info", { path }),

  /** 读取仓库指定时间窗的提交（会话→Commit 溯源）；非仓库/失败返回空数组 */
  gitLog: (path: string, since: string | null, until: string | null, limit: number) =>
    invoke<CommitInfo[]>("git_log", { path, since, until, limit }),

  /** 返回与某会话关联的提交（trailer 精确 / 时间窗可能相关）。判据在 Rust 单点。 */
  sessionCommits: (sessionId: string, provider: string) =>
    invoke<CorrelatedCommit[]>("session_commits", { sessionId, provider }),

  /** 返回会话改动的文件（从转录 Write/Edit/MultiEdit 还原，含未提交改动）。v1 仅 Claude。 */
  sessionFileChanges: (provider: string, sessionId: string) =>
    invoke<FileChange[]>("session_file_changes", { provider, sessionId }),

  /** 返回会话「规划的任务」（Claude TaskCreate/TaskUpdate 落盘状态），供同步到看板。v1 仅 Claude。 */
  sessionTasks: (provider: string, sessionId: string) =>
    invoke<PlannedTask[]>("session_tasks", { provider, sessionId }),

  // ── 会话溯源 git 钩子（Phase 2） ──────────────────────────
  /** 查询某仓库的会话溯源钩子状态 */
  sessionHookStatus: (path: string) => invoke<HookStatus>("session_hook_status", { path }),
  /** 在某仓库启用会话溯源（安装 prepare-commit-msg 钩子，幂等、与他人钩子共存） */
  installSessionTrailerHook: (path: string) =>
    invoke<void>("install_session_trailer_hook", { path }),
  /** 停用（移除 rework 的钩子标记块 + marker） */
  uninstallSessionTrailerHook: (path: string) =>
    invoke<void>("uninstall_session_trailer_hook", { path }),

  // ── 实时活动 hook（Phase 2：Claude Code PostToolUse 全量工具流） ──────
  /** 查询 rework 实时活动 hook 状态（是否安装 + 是否当前版本；up_to_date=false 表示装了但过期需升级） */
  activityHookStatus: () =>
    invoke<{ installed: boolean; up_to_date: boolean }>("activity_hook_status"),
  /** 安装实时活动 hook（写 ~/.claude/settings.json 的 PostToolUse，幂等、保留用户其它设置） */
  installActivityHook: () => invoke<void>("install_activity_hook"),
  /** 卸载实时活动 hook（只移除 rework 自己那一条） */
  uninstallActivityHook: () => invoke<void>("uninstall_activity_hook"),

  // ── AI 对话（provider 可切；包装 ai_chat 命令） ────────────
  /** 非流式对话：返回助手回复文本。cwd=项目仓库路径（可选），CLI provider 在该目录下运行。 */
  aiChat: (config: AiConfig, messages: AiChatMessage[], cwd?: string) =>
    invoke<string>("ai_chat", { config, messages, cwd }),

  /** 一轮工具对话：返回「最终文本」或「待执行工具调用」（agent loop 由前端驱动） */
  aiChatTools: (
    config: AiConfig,
    messages: ToolChatMessage[],
    tools: AiToolDef[],
  ) => invoke<AiToolTurn>("ai_chat_tools", { config, messages, tools }),

  /** 流式对话：经 Tauri Channel 实时回调增量事件；Promise 在结束时 resolve。
   *  streamId 用于「停止生成」（调 aiCancelStream 同一 id）。 */
  aiChatStream: (
    config: AiConfig,
    messages: AiChatMessage[],
    streamId: string,
    onEvent: (ev: AiStreamEvent) => void,
    withTools = false,
    cwd?: string,
  ) => {
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
    invoke<void>("ai_cancel_stream", { streamId }),

  /** 拉取服务商可用模型 id 列表；本地 CLI 返回空数组，失败时 reject（前端回退手填）。 */
  listModels: (config: AiConfig) =>
    invoke<string[]>("list_models", { config }),

  // ── RAG 语义检索 ───────────────────────────────────────────
  /** 语义召回：返回与 query 最相似的历史会话片段列表（limit 默认 8） */
  ragSearch: (config: EmbedConfig, query: string, limit: number) =>
    invoke<RagHit[]>("rag_search", { config, query, limit }),

  /** 为全量历史会话建嵌入索引；返回已索引的消息数 */
  ragBuildIndex: (config: EmbedConfig) =>
    invoke<number>("rag_build_index", { config }),

  // 通用文本嵌入（记忆语义去重用）
  embedTexts: (config: EmbedConfig, texts: string[]) =>
    invoke<number[][]>("embed_texts", { config, texts }),

  // 记忆注入项目文件
  memoryWriteProjectFiles: (
    repoPath: string,
    mems: { content: string; kind: string; scope: string }[],
  ) => invoke<string[]>("memory_write_project_files", { repoPath, mems }),
  memoryProjectFilesStatus: (repoPath: string) =>
    invoke<MemFilesStatus>("memory_project_files_status", { repoPath }),

  /** 扫描 Claude 文件记忆（各项目 memory 目录下的 .md），供记忆桥导入记忆账本 */
  scanFileMemories: () => invoke<FileMemory[]>("scan_file_memories"),
};
