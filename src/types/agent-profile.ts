// agent_profiles 集合类型（命名队友，owner-only）。字段对齐迁移 1786400000。
export interface AgentProfile {
  id: string;
  owner: string;
  name: string;
  /** 头像 emoji（空则用 provider 首字母兜底） */
  emoji?: string;
  /** 主题色键（providers.ts 色板键，如 amber/sky） */
  color?: string;
  /** 底层 CLI provider（claude/codex） */
  provider: string;
  /** 默认指令（prepend 到任务 prompt） */
  instructions?: string;
  /** 绑定的指令库技能（prompt id 数组） */
  skill_prompts?: string[];
  /** 额外自由文本技能 */
  skill_text?: string;
  /** 超时覆盖秒（空/0=全局默认） */
  timeout_secs?: number;
  /** 并发上限（空/0=默认 1） */
  max_concurrent?: number;
  /** 工具/危险标志（默认 true） */
  with_tools?: boolean;
  /** 完成后 worktree 内自动 commit（默认 false） */
  auto_commit?: boolean;
  archived?: boolean;
  deleted_at?: string;
  created: string;
  updated: string;
}
