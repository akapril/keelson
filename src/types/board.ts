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
}
export interface BoardLabel {
  id: string;
  project: string;
  name: string;
  color: string;
  created: string;
  updated: string;
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
  created_by: string;
  source_session_id?: string;
  source_provider?: string;
  source_anchor?: string;
  created: string;
  updated: string;
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
export interface BoardTemplate {
  id: string;
  owner: string;
  name: string;
  description?: string;
  states: TemplateStateDef[];
  labels?: TemplateLabelDef[];
  created: string;
  updated: string;
}
