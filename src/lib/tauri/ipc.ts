import { invoke } from "@tauri-apps/api/core";
import type { Session, SessionHit, TimelineMessage } from "../../types/session";
import type { AiConfig, AiChatMessage } from "../../types/ai";
// 唯一允许出现 invoke 字符串命令名的地方。新增本地能力只加一个方法。
export const ipc = {
  ping: () => invoke<string>("ping"),

  // ── 会话列表 ──────────────────────────────────────────────
  /** 获取所有本地会话（Task 17） */
  listSessions: () => invoke<Session[]>("sessions_list"),

  /** 全文搜索会话（Task 17，MVP 暂未使用，留待后续调用） */
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
};
