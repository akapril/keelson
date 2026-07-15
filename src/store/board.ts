// Board Zustand Store —— 状态管理 + 任务 CRUD（不含拖拽排序）。
// 数据访问统一走 src/lib/pb/board.ts，本文件不直接调用 pb.collection。
import { create } from "zustand";
import {
  listTemplates,
  listProjects,
  listStates,
  listLabels,
  listTasks,
  createRecord,
  updateRecord,
  deleteRecord,
} from "../lib/pb/board";
import { COL } from "../lib/pb/collections";
import { currentUserId } from "../lib/pb";
import { nextRank } from "./board-rank";
import {
  createProjectFromTemplate as _createProjectFromTemplate,
  type CreateProjectInput,
} from "../features/board/create-project";
import type {
  BoardTemplate,
  BoardProject,
  BoardState,
  BoardLabel,
  BoardTask,
  TaskPriority,
} from "../types/board";

// ── 纯辅助函数（可独立测试） ─────────────────────────────
/**
 * 将任务列表按 state ID 分组，保留原始顺序。
 * @param tasks 任务数组（按 rank 排序后传入）
 * @returns state ID → BoardTask[] 映射
 */
export function groupTasksByState(
  tasks: BoardTask[],
): Record<string, BoardTask[]> {
  const result: Record<string, BoardTask[]> = {};
  for (const task of tasks) {
    if (!result[task.state]) {
      result[task.state] = [];
    }
    result[task.state].push(task);
  }
  return result;
}

// ── 创建任务的输入参数类型 ────────────────────────────────
export interface CreateTaskInput {
  project: string;
  state: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  due_date?: string;
  assignees?: string[];
  labels?: string[];
  source_session_id?: string;
  source_provider?: string;
  source_anchor?: string;
}

// ── Store 状态类型 ─────────────────────────────────────────
interface BoardStoreState {
  /** 所有可用的看板模板 */
  templates: BoardTemplate[];
  /** 当前用户可见的所有看板项目 */
  projects: BoardProject[];
  /** 当前打开的项目 ID（null = 未打开） */
  openedProjectId: string | null;
  /** 当前项目的状态列（按 sort_order 排序） */
  states: BoardState[];
  /** 当前项目的标签 */
  labels: BoardLabel[];
  /** 当前项目的所有任务（按 rank 排序） */
  tasks: BoardTask[];
  /** 数据加载中 */
  loading: boolean;
  /** 最近一次错误信息 */
  error?: string;

  // ── 动作 ────────────────────────────────────────────────
  /** 加载所有模板 */
  loadTemplates: () => Promise<void>;
  /** 加载所有项目 */
  loadProjects: () => Promise<void>;
  /**
   * 打开指定项目：加载该项目的 states / labels / tasks。
   * 同时更新 openedProjectId。
   */
  openProject: (id: string) => Promise<void>;
  /** 在当前项目的指定状态列末尾新建任务 */
  createTask: (input: CreateTaskInput) => Promise<BoardTask>;
  /** 更新任务字段（乐观更新 + 写回 PB） */
  updateTask: (id: string, patch: Partial<BoardTask>) => Promise<void>;
  /** 删除任务 */
  deleteTask: (id: string) => Promise<void>;
  /** 按状态 ID 分组当前所有任务，用于看板列渲染 */
  tasksByState: () => Record<string, BoardTask[]>;
  /**
   * 从模板创建项目（前端编排 + 补偿）并刷新项目列表。
   * 委托给 src/features/board/create-project.ts。
   */
  createProject: (input: CreateProjectInput) => Promise<BoardProject>;
}

// ── Store 实现 ─────────────────────────────────────────────
export const useBoardStore = create<BoardStoreState>((set, get) => ({
  templates: [],
  projects: [],
  openedProjectId: null,
  states: [],
  labels: [],
  tasks: [],
  loading: false,
  error: undefined,

  // ── 加载模板 ────────────────────────────────────────────
  loadTemplates: async () => {
    set({ loading: true, error: undefined });
    try {
      const templates = await listTemplates();
      set({ templates, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  // ── 加载项目列表 ─────────────────────────────────────────
  loadProjects: async () => {
    set({ loading: true, error: undefined });
    try {
      const projects = await listProjects();
      set({ projects, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  // ── 打开项目（并行加载 states / labels / tasks） ──────────
  openProject: async (id: string) => {
    set({ loading: true, error: undefined, openedProjectId: id });
    try {
      const [states, labels, tasks] = await Promise.all([
        listStates(id),
        listLabels(id),
        listTasks(id),
      ]);
      set({ states, labels, tasks, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  // ── 新建任务 ─────────────────────────────────────────────
  createTask: async (input: CreateTaskInput) => {
    const { tasks } = get();
    // 计算该状态列的当前最大 rank
    const tasksInState = tasks.filter((t) => t.state === input.state);
    const maxRank =
      tasksInState.length > 0
        ? Math.max(...tasksInState.map((t) => t.rank ?? 0))
        : null;
    const rank = nextRank(maxRank);

    const data: Record<string, unknown> = {
      project: input.project,
      state: input.state,
      title: input.title,
      priority: input.priority ?? "none",
      rank,
      created_by: currentUserId(),
    };
    // 仅传入有值的可选字段，避免 PB 收到 undefined
    if (input.description != null) data.description = input.description;
    if (input.due_date != null) data.due_date = input.due_date;
    if (input.assignees != null) data.assignees = input.assignees;
    if (input.labels != null) data.labels = input.labels;
    if (input.source_session_id != null)
      data.source_session_id = input.source_session_id;
    if (input.source_provider != null)
      data.source_provider = input.source_provider;
    if (input.source_anchor != null) data.source_anchor = input.source_anchor;

    const created = await createRecord<BoardTask>(COL.boardTasks, data);
    // 追加到本地任务列表末尾
    set((s) => ({ tasks: [...s.tasks, created] }));
    return created;
  },

  // ── 更新任务（乐观 + PB 写回） ──────────────────────────
  updateTask: async (id: string, patch: Partial<BoardTask>) => {
    const { tasks } = get();
    // 乐观更新本地状态
    set({
      tasks: tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
    try {
      await updateRecord<BoardTask>(
        COL.boardTasks,
        id,
        patch as Record<string, unknown>,
      );
    } catch (e) {
      // 回滚
      set({ tasks, error: String(e) });
    }
  },

  // ── 删除任务 ─────────────────────────────────────────────
  deleteTask: async (id: string) => {
    const { tasks } = get();
    // 乐观移除
    set({ tasks: tasks.filter((t) => t.id !== id) });
    try {
      await deleteRecord(COL.boardTasks, id);
    } catch (e) {
      // 回滚
      set({ tasks, error: String(e) });
    }
  },

  // ── 按状态分组（计算属性） ──────────────────────────────
  tasksByState: () => groupTasksByState(get().tasks),

  // ── 从模板创建项目（编排 + 补偿 + 刷新列表） ──────────
  createProject: async (input: CreateProjectInput) => {
    const project = await _createProjectFromTemplate(input);
    // 创建成功后刷新项目列表
    await get().loadProjects();
    return project;
  },
}));
