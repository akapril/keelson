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
  subscribeProject,
} from "../lib/pb/board";
import { COL } from "../lib/pb/collections";
import { currentUserId } from "../lib/pb";
import { nextRank, rankBetween } from "./board-rank";
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
  StateCategory,
} from "../types/board";

// ── 实时订阅的退订句柄（模块级，仅保留当前打开项目的订阅） ──
let unsub: (() => void) | null = null;

/** upsert：按 id 替换，不存在则追加（使实时 echo 幂等，收敛乐观更新） */
function upsertById<T extends { id: string }>(list: T[], rec: T): T[] {
  const idx = list.findIndex((x) => x.id === rec.id);
  if (idx === -1) return [...list, rec];
  const next = list.slice();
  next[idx] = rec;
  return next;
}

/** remove：按 id 过滤移除 */
function removeById<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((x) => x.id !== id);
}

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
  /**
   * 关闭当前项目：取消实时订阅并清空 states / labels / tasks，
   * 将 openedProjectId 置空。
   */
  closeProject: () => void;
  /** 在当前项目的指定状态列末尾新建任务 */
  createTask: (input: CreateTaskInput) => Promise<BoardTask>;
  /** 更新任务字段（乐观更新 + 写回 PB） */
  updateTask: (id: string, patch: Partial<BoardTask>) => Promise<void>;
  /** 删除任务 */
  deleteTask: (id: string) => Promise<void>;
  /** 按状态 ID 分组当前所有任务，用于看板列渲染 */
  tasksByState: () => Record<string, BoardTask[]>;
  /**
   * 拖拽移动任务：将任务移到目标状态列的指定位置（乐观更新 + 回滚）。
   * toIndex 为目标列（排除被拖拽任务本身后）的插入位置。
   */
  moveTask: (taskId: string, toStateId: string, toIndex: number) => Promise<void>;
  /**
   * 从模板创建项目（前端编排 + 补偿）并刷新项目列表。
   * 委托给 src/features/board/create-project.ts。
   */
  createProject: (input: CreateProjectInput) => Promise<BoardProject>;

  // ── 项目设置：状态列 CRUD（作用于当前打开的项目） ─────────
  /** 在当前项目新建状态列；未指定 sort_order 时追加到末尾。 */
  createState: (input: {
    name: string;
    color: string;
    category: StateCategory;
    sort_order?: number;
  }) => Promise<void>;
  /** 更新状态列字段。 */
  updateState: (
    id: string,
    patch: Partial<{
      name: string;
      color: string;
      category: StateCategory;
      sort_order: number;
    }>,
  ) => Promise<void>;
  /** 删除状态列；若该状态下仍有任务则拒绝删除。 */
  deleteState: (id: string) => Promise<void>;

  // ── 项目设置：标签 CRUD（作用于当前打开的项目） ───────────
  /** 在当前项目新建标签。 */
  createLabel: (input: { name: string; color: string }) => Promise<void>;
  /** 更新标签字段。 */
  updateLabel: (
    id: string,
    patch: Partial<{ name: string; color: string }>,
  ) => Promise<void>;
  /** 删除标签。 */
  deleteLabel: (id: string) => Promise<void>;

  // ── 项目设置：更新项目本身 ────────────────────────────────
  /** 更新项目字段，并同步 projects 数组中的对应条目。 */
  updateProject: (
    id: string,
    patch: Partial<{
      name: string;
      description: string;
      repo_path: string;
      archived: boolean;
    }>,
  ) => Promise<void>;
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

  // ── 打开项目（并行加载 states / labels / tasks + 实时订阅） ──
  openProject: async (id: string) => {
    // 切换项目前先取消上一个项目的订阅，避免泄漏
    if (unsub) {
      unsub();
      unsub = null;
    }
    set({ loading: true, error: undefined, openedProjectId: id });
    try {
      const [states, labels, tasks] = await Promise.all([
        listStates(id),
        listLabels(id),
        listTasks(id),
      ]);
      set({ states, labels, tasks, loading: false });
      // 加载成功后订阅该项目的实时变更；upsert-by-id 使 echo 幂等
      unsub = await subscribeProject(id, {
        onTask: (action, rec) =>
          set((s) => ({
            tasks:
              action === "delete"
                ? removeById(s.tasks, rec.id)
                : upsertById(s.tasks, rec),
          })),
        onState: (action, rec) =>
          set((s) => ({
            states:
              action === "delete"
                ? removeById(s.states, rec.id)
                : upsertById(s.states, rec),
          })),
        onLabel: (action, rec) =>
          set((s) => ({
            labels:
              action === "delete"
                ? removeById(s.labels, rec.id)
                : upsertById(s.labels, rec),
          })),
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  // ── 关闭项目（退订 + 清空当前项目数据） ──────────────────
  closeProject: () => {
    // 取消实时订阅并释放句柄
    unsub?.();
    unsub = null;
    set({ openedProjectId: null, states: [], labels: [], tasks: [] });
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

  // ── 拖拽移动任务（rank 计算 + 乐观更新 + 回滚） ────────
  moveTask: async (taskId: string, toStateId: string, toIndex: number) => {
    const { tasks } = get();
    // 快照，用于失败时回滚
    const snapshot = tasks;

    // 目标列已排序任务（排除被拖拽任务本身）
    const targetTasks = tasks
      .filter((t) => t.state === toStateId && t.id !== taskId)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

    // 计算插入位置的前后邻居
    const before = targetTasks[toIndex - 1];
    const after = targetTasks[toIndex];
    const rank = rankBetween(before?.rank, after?.rank);

    // 乐观更新：修改 state 和 rank
    set({
      tasks: tasks.map((t) =>
        t.id === taskId ? { ...t, state: toStateId, rank } : t,
      ),
    });

    try {
      // 写回 PB
      await updateRecord(COL.boardTasks, taskId, {
        state: toStateId,
        rank,
      });
    } catch (e) {
      // 失败则回滚到快照
      set({ tasks: snapshot, error: String(e) });
    }
  },

  // ── 从模板创建项目（编排 + 补偿 + 刷新列表） ──────────
  createProject: async (input: CreateProjectInput) => {
    const project = await _createProjectFromTemplate(input);
    // 创建成功后刷新项目列表
    await get().loadProjects();
    return project;
  },

  // ── 新建状态列 ───────────────────────────────────────────
  createState: async (input) => {
    const { openedProjectId, states } = get();
    if (!openedProjectId) throw new Error("未打开任何项目");
    // 未指定 sort_order 时，追加到当前状态列末尾
    const sortOrder =
      input.sort_order ??
      (states.length > 0
        ? Math.max(...states.map((s) => s.sort_order)) + 1024
        : 1024);
    const created = await createRecord<BoardState>(COL.boardStates, {
      project: openedProjectId,
      name: input.name,
      color: input.color,
      category: input.category,
      sort_order: sortOrder,
    });
    // 追加后按 sort_order 排序，保持与列表约定一致
    set((s) => ({
      states: [...s.states, created].sort(
        (a, b) => a.sort_order - b.sort_order,
      ),
    }));
  },

  // ── 更新状态列 ───────────────────────────────────────────
  updateState: async (id, patch) => {
    const updated = await updateRecord<BoardState>(
      COL.boardStates,
      id,
      patch as Record<string, unknown>,
    );
    set((s) => ({
      states: s.states
        .map((st) => (st.id === id ? updated : st))
        .sort((a, b) => a.sort_order - b.sort_order),
    }));
  },

  // ── 删除状态列（带任务占用守卫） ─────────────────────────
  deleteState: async (id) => {
    const { tasks } = get();
    // 守卫：该状态下仍有任务则拒绝删除
    if (tasks.some((t) => t.state === id)) {
      throw new Error("该状态下仍有任务，无法删除");
    }
    await deleteRecord(COL.boardStates, id);
    set((s) => ({ states: s.states.filter((st) => st.id !== id) }));
  },

  // ── 新建标签 ─────────────────────────────────────────────
  createLabel: async (input) => {
    const { openedProjectId } = get();
    if (!openedProjectId) throw new Error("未打开任何项目");
    const created = await createRecord<BoardLabel>(COL.boardLabels, {
      project: openedProjectId,
      name: input.name,
      color: input.color,
    });
    set((s) => ({ labels: [...s.labels, created] }));
  },

  // ── 更新标签 ─────────────────────────────────────────────
  updateLabel: async (id, patch) => {
    const updated = await updateRecord<BoardLabel>(
      COL.boardLabels,
      id,
      patch as Record<string, unknown>,
    );
    set((s) => ({
      labels: s.labels.map((l) => (l.id === id ? updated : l)),
    }));
  },

  // ── 删除标签 ─────────────────────────────────────────────
  deleteLabel: async (id) => {
    await deleteRecord(COL.boardLabels, id);
    set((s) => ({ labels: s.labels.filter((l) => l.id !== id) }));
  },

  // ── 更新项目（同步 projects 数组 + 打开中的项目） ────────
  updateProject: async (id, patch) => {
    const updated = await updateRecord<BoardProject>(
      COL.boardProjects,
      id,
      patch as Record<string, unknown>,
    );
    // 同步 projects 数组中的对应条目
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? updated : p)),
    }));
  },
}));
