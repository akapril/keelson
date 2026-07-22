// 指令库类型 —— 对应 PB prompts 集合（owner-only）。

/**
 * 指令类型：
 * - snippet 会话/AI 面板插入片段（支持 {{变量}} 替换）
 * - report  工作报告模板（作系统提示，不做变量替换）
 * 旧数据可能缺省 → 用 promptType() 归一为 snippet。
 */
export type PromptType = "snippet" | "report";

export interface Prompt {
  id: string;
  owner: string;
  /** 指令标题（也用于斜杠 /名称 匹配） */
  title: string;
  /** 指令正文，可含 {{变量}} 占位（仅 snippet 类型插入时替换） */
  content: string;
  /** 空格/逗号分隔的标签串（复用 reading 的 splitTags/joinTags 风格） */
  tags: string;
  /** 类型（旧数据可能缺省，视为 snippet） */
  type?: PromptType;
  created: string;
  updated: string;
}
