// 指令库类型 —— 对应 PB prompts 集合（owner-only）。
export interface Prompt {
  id: string;
  owner: string;
  /** 指令标题（也用于斜杠 /名称 匹配） */
  title: string;
  /** 指令正文，可含 {{变量}} 占位 */
  content: string;
  /** 空格/逗号分隔的标签串（复用 reading 的 splitTags/joinTags 风格） */
  tags: string;
  created: string;
  updated: string;
}
