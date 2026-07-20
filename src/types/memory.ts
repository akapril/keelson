// 记忆账本类型 —— 对应 PB memories 集合（owner-only）。

/** 记忆粒度：事实 / 偏好 / 决策 / 约定。 */
export type MemoryKind = "fact" | "preference" | "decision" | "convention";
/** 作用域：global 进每个 CLAUDE.md；project 仅对应仓库。 */
export type MemoryScope = "global" | "project";

export interface Memory {
  id: string;
  owner: string;
  /** 记忆正文（一句话断言） */
  content: string;
  kind: MemoryKind;
  scope: MemoryScope;
  /** scope=project 时的关联项目 id（可空） */
  project: string;
  /** 置信度（多来源命中累加） */
  confidence: number;
  /** 溯源：来源会话 / provider / 锚点 */
  source_session_id: string;
  source_provider: string;
  source_anchor: string;
  /** 去重合并时指向胜出记忆 id */
  superseded_by: string;
  created: string;
  updated: string;
}

export const MEMORY_KIND_LABEL: Record<MemoryKind, string> = {
  fact: "事实",
  preference: "偏好",
  decision: "决策",
  convention: "约定",
};
