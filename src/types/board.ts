// 字段逐字对齐 PB 迁移(1720000100_board.js)的 snake_case 字段名。
export type StateCategory = "pending" | "active" | "completed";
export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";
export type MemberRole = "admin" | "member" | "viewer";

export interface BoardProject {
  id: string;
  owner: string;
  name: string;
  description?: string;
  archived?: boolean;
  repo_path?: string;
  /** 是否收藏（侧栏收藏组展示） */
  pinned?: boolean;
  /** 收藏项排序键（浮点 rank，未收藏时忽略） */
  pin_rank?: number;
  created: string;
  updated: string;
}
export interface BoardState {
  id: string;
  project: string;
  name: string;
  color: string;
  category: StateCategory;
  sort_order: number;
  created: string;
  updated: string;
  /** 软删除时间戳（非空即已删）；多机同步用。 */
  deleted_at?: string;
}
export interface BoardLabel {
  id: string;
  project: string;
  name: string;
  color: string;
  created: string;
  updated: string;
  /** 软删除时间戳（非空即已删）；多机同步用。 */
  deleted_at?: string;
}
export interface BoardTask {
  id: string;
  project: string;
  state: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  rank?: number;
  due_date?: string;
  assignees?: string[];
  labels?: string[];
  /** 已归档（完成任务软删除，默认隐藏；保留溯源）。 */
  archived?: boolean;
  created_by: string;
  source_session_id?: string;
  source_provider?: string;
  source_anchor?: string;
  created: string;
  updated: string;
  /** 软删除时间戳（非空即已删）；多机同步用。 */
  deleted_at?: string;
}
export interface BoardMember {
  id: string;
  project: string;
  user: string;
  role: MemberRole;
  created: string;
  updated: string;
}
export interface TemplateStateDef {
  name: string;
  color: string;
  category: StateCategory;
}
export interface TemplateLabelDef {
  name: string;
  color: string;
}
/** 模板初始任务：category 决定落在哪个状态列（该类别首个状态，缺省落首列）。 */
export interface TemplateTaskDef {
  title: string;
  description?: string;
  category?: StateCategory;
}
/** 模板起始文档：建项目时自动创建并链接到该项目（best-effort）。 */
export interface TemplateDocDef {
  title: string;
  content: string;
}
export interface BoardTemplate {
  id: string;
  owner: string;
  name: string;
  description?: string;
  /** 领域分类（新建对话框按它分组，如 开发/职场管理/内容营销/个人生活/商业创业）；旧数据可空 */
  category?: string;
  states: TemplateStateDef[];
  labels?: TemplateLabelDef[];
  /** 初始任务（可选）：开箱即用的工作流步骤。 */
  tasks?: TemplateTaskDef[];
  /** 起始文档（可选）：如 spec 骨架 / 内容日历。 */
  starter_docs?: TemplateDocDef[];
  created: string;
  updated: string;
}
