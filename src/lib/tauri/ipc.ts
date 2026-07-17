import { invoke, Channel } from "@tauri-apps/api/core";
import type { Session, SessionHit, TimelineMessage } from "../../types/session";
import type { EmbedConfig, RagHit } from "@/types/rag";
import type {
  AiConfig,
  AiChatMessage,
  AiStreamEvent,
  ToolChatMessage,
  AiToolDef,
  AiToolTurn,
} from "../../types/ai";
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

  // ── AI 对话（provider 可切；包装 ai_chat 命令） ────────────
  /** 非流式对话：返回助手回复文本 */
  aiChat: (config: AiConfig, messages: AiChatMessage[]) =>
    invoke<string>("ai_chat", { config, messages }),

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
  ) => {
    const channel = new Channel<AiStreamEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("ai_chat_stream", {
      config,
      messages,
      streamId,
      onEvent: channel,
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
};
