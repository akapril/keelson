// Board Zustand Store —— 状态管理 + 任务 CRUD（不含拖拽排序）。
// 数据访问统一走 src/lib/pb/board.ts，本文件不直接调用 pb.collection。
import { create } from "zustand";
import {
  listTemplates,
  listProjects,
  listStates,
  listLabels,
  listTasks,
  listMembers,
  createRecord,
  updateRecord,
  deleteRecord,
  subscribeProject,
} from "../lib/pb/board";
import { isTombstoned } from "../lib/pb/tombstone";
import { COL } from "../lib/pb/collections";
import { currentUserId } from "../lib/pb";
import { nextRank, rankBetween } from "./board-rank";
import {
  createProjectFromTemplate as _createProjectFromTemplate,
  type CreateProjectInput,
} from "../features/board/create-project";
import { taskAnchor, type PlanTask } from "../features/board/plan-import";
import { listAllDocs, updateDocRecord, deleteDocRecord } from "../lib/pb/docs";
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
/** 收藏项目：只取 pinned，按 pin_rank 升序（未收藏/无 rank 视为 0）。纯函数，便于测试。 */
export function selectPinnedProjects(projects: BoardProject[]): BoardProject[] {
  return projects
    .filter((pj) => pj.pinned)
    .sort((a, b) => (a.pin_rank ?? 0) - (b.pin_rank ?? 0));
}

/** 当前收藏项里最大的 pin_rank（无收藏返回 null），用于「加星追加到末尾」。 */
function maxPinRank(projects: BoardProject[]): number | null {
  const ranks = projects
    .filter((pj) => pj.pinned && pj.pin_rank != null)
    .map((pj) => pj.pin_rank as number);
  return ranks.length ? Math.max(...ranks) : null;
}

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
  /** 导入计划任务为看板卡片（幂等：同 source_anchor 跳过）。 */
  importPlanTasks: (
    tasks: PlanTask[],
    planName: string,
  ) => Promise<{ created: number; skipped: number }>;
  /** 更新任务字段（乐观更新 + 写回 PB） */
  updateTask: (id: string, patch: Partial<BoardTask>) => Promise<void>;
  /** 删除任务 */
  deleteTask: (id: string) => Promise<void>;
  /** 按状态 ID 分组当前所有任务，用于看板列渲染 */
  tasksByState: () => Record<string, BoardTask[]>;
  /**
   * 拖拽过程中的本地预览移动（仅改内存，不落库）。
   * 跨列悬停时把任务移入目标列的指定位置，使卡片实时跟随；落手由 moveTask 持久化。
   */
  previewMove: (taskId: string, toStateId: string, toIndex: number) => void;
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
  /** 切换项目收藏：收藏→pinned=true 且 pin_rank 追加到末尾；取消→pinned=false。乐观+回滚重抛。 */
  toggleProjectPin: (id: string) => Promise<void>;
  /** 拖拽重排收藏项：按目标位置算 rankBetween，写 pin_rank。乐观+回滚重抛。 */
  reorderPin: (id: string, toIndex: number) => Promise<void>;
  /**
   * 删除项目（先删任务再删项目，PB 级联删其状态列/标签/成员）。
   * @param opts.deleteDocs 为 true 时，删除**仅属于本项目**的文档；与其他项目共享的仍只解除关联。
   */
  deleteProject: (id: string, opts?: { deleteDocs?: boolean }) => Promise<void>;
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
              action === "delete" || isTombstoned(rec)
                ? removeById(s.tasks, rec.id)
                : upsertById(s.tasks, rec),
          })),
        onState: (action, rec) =>
          set((s) => ({
            states:
              action === "delete" || isTombstoned(rec)
                ? removeById(s.states, rec.id)
                : upsertById(s.states, rec),
          })),
        onLabel: (action, rec) =>
          set((s) => ({
            labels:
              action === "delete" || isTombstoned(rec)
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
    // 按 id upsert 去重：PB 实时 create 事件可能在 await 期间已插入同一条，
    // 避免本地再追加一次造成重复显示。
    set((s) => ({ tasks: upsertById(s.tasks, created) }));
    return created;
  },

  // ── 导入计划任务为卡片（幂等） ───────────────────────────
  importPlanTasks: async (tasks, planName) => {
    const { states, tasks: existing, createTask, openedProjectId } = get();
    if (!openedProjectId) return { created: 0, skipped: 0 };
    // 待办落首个 pending 列（无则首个 state）；已完成(- [x]/status:done)落首个 completed 列
    const pending = states.find((s) => s.category === "pending") ?? states[0];
    if (!pending) return { created: 0, skipped: 0 };
    const completed = states.find((s) => s.category === "completed");
    let created = 0;
    let skipped = 0;
    for (const t of tasks) {
      const anchor = taskAnchor(planName, t.n);
      // 幂等：项目内已有同 source_anchor 的卡片则跳过
      if (existing.some((x) => x.source_anchor === anchor)) {
        skipped++;
        continue;
      }
      // 已完成任务尽量落完成列，缺完成列则退回 pending
      const target = t.done && completed ? completed : pending;
      await createTask({
        project: openedProjectId,
        state: target.id,
        title: t.title,
        description: t.body,
        source_anchor: anchor,
        source_provider: "rework-plan",
      });
      created++;
    }
    return { created, skipped };
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
      // 回滚本地乐观更新，并重抛：让调用方能真实感知失败（批量/归档/AI 工具据此报错，
      // 不再误报成功）。所有调用点均已 try/catch 或 allSettled 处理拒绝。
      set({ tasks, error: String(e) });
      throw e;
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
      // 回滚并重抛：让调用方真实感知失败（批量删除/单卡删除据此报错，不再误报成功）。
      // 三处调用点均已 try/catch 或 .catch 处理。
      set({ tasks, error: String(e) });
      throw e;
    }
  },

  // ── 按状态分组（计算属性） ──────────────────────────────
  tasksByState: () => groupTasksByState(get().tasks),

  // ── 拖拽预览移动（仅改内存，计算 rank，不落库） ──────────
  previewMove: (taskId: string, toStateId: string, toIndex: number) => {
    const { tasks } = get();
    // 目标列已排序任务（排除被拖拽任务本身）
    const targetTasks = tasks
      .filter((t) => t.state === toStateId && t.id !== taskId)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

    // 计算插入位置的前后邻居 → 新 rank
    const before = targetTasks[toIndex - 1];
    const after = targetTasks[toIndex];
    const rank = rankBetween(before?.rank, after?.rank);

    // 若目标位置无变化（同列同 rank）则跳过 set，避免无谓重渲染
    const current = tasks.find((t) => t.id === taskId);
    if (current && current.state === toStateId && current.rank === rank) return;

    set({
      tasks: tasks.map((t) =>
        t.id === taskId ? { ...t, state: toStateId, rank } : t,
      ),
    });
  },

  // ── 拖拽移动任务（复用 previewMove 乐观更新 + 落库 + 回滚） ──
  moveTask: async (taskId: string, toStateId: string, toIndex: number) => {
    // 快照，用于失败时回滚
    const snapshot = get().tasks;

    // 乐观更新（含 rank 计算）
    get().previewMove(taskId, toStateId, toIndex);
    const moved = get().tasks.find((t) => t.id === taskId);
    if (!moved) return;

    try {
      // 写回 PB（使用 previewMove 计算出的最终 state / rank）
      await updateRecord(COL.boardTasks, taskId, {
        state: moved.state,
        rank: moved.rank,
      });
    } catch (e) {
      // 失败则回滚到快照，并重抛（与 updateTask/deleteTask 一致，供调用点 toast）
      set({ tasks: snapshot, error: String(e) });
      throw e;
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
      // upsert 去重（实时 create echo 可能已插入），再按 sort_order 排序
      states: upsertById(s.states, created).sort(
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
    // upsert 去重（实时 create echo 可能已插入）
    set((s) => ({ labels: upsertById(s.labels, created) }));
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

  // ── 切换收藏（乐观 + 回滚重抛） ─────────────────────────
  toggleProjectPin: async (id) => {
    const snapshot = get().projects;
    const proj = snapshot.find((p) => p.id === id);
    if (!proj) return;
    const willPin = !proj.pinned;
    // 收藏→追加到末尾 rank；取消→仅置 pinned=false（pin_rank 保留、忽略）
    const patch = willPin
      ? { pinned: true, pin_rank: nextRank(maxPinRank(snapshot)) }
      : { pinned: false };
    set({
      projects: snapshot.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
    try {
      await updateRecord(COL.boardProjects, id, patch as Record<string, unknown>);
    } catch (e) {
      set({ projects: snapshot, error: String(e) });
      throw e;
    }
  },

  // ── 拖拽重排收藏（乐观 + 回滚重抛） ─────────────────────
  reorderPin: async (id, toIndex) => {
    const snapshot = get().projects;
    // 只对已收藏项重排；传入未收藏 id 直接忽略（防写出 pinned=false 却有 rank 的脏记录）
    const proj = snapshot.find((p) => p.id === id);
    if (!proj?.pinned) return;
    // 排除自己后取前后邻居的 pin_rank，算落点 rank（?.pin_rank 已是 number|undefined，直接传）
    const others = selectPinnedProjects(snapshot).filter((p) => p.id !== id);
    const before = others[toIndex - 1]?.pin_rank;
    const after = others[toIndex]?.pin_rank;
    const newRank = rankBetween(before, after);
    set({
      projects: snapshot.map((p) => (p.id === id ? { ...p, pin_rank: newRank } : p)),
    });
    try {
      await updateRecord(COL.boardProjects, id, { pin_rank: newRank });
    } catch (e) {
      set({ projects: snapshot, error: String(e) });
      throw e;
    }
  },

  // ── 删除项目 ─────────────────────────────────────────────
  deleteProject: async (id, opts) => {
    // 文档多对多不级联：逐个处理关联本项目的文档。
    // - 勾选「删文档」且该文档**仅**属于本项目 → 删除文档；
    // - 否则（未勾选，或该文档还关联着别的项目）→ 只解除与本项目的关联，保留文档。
    try {
      const docs = await listAllDocs();
      for (const d of docs) {
        if (!d.projects?.includes(id)) continue;
        const others = d.projects.filter((p) => p !== id);
        if (opts?.deleteDocs && others.length === 0) {
          await deleteDocRecord(d.id); // 已改软删
        } else {
          await updateDocRecord(d.id, { projects: others });
        }
      }
    } catch {
      /* 断链/删文档失败不阻断项目删除（残留 id 在 UI 侧会被过滤忽略） */
    }
    // 软删不触发 PB cascadeDelete，故手动软删全部子记录：任务/状态/标签/成员。
    // 拉的是活跃(未删)子记录（Task 5 后 listXxx 已过滤软删记录）。
    const [tasks, states, labels, members] = await Promise.all([
      listTasks(id),
      listStates(id),
      listLabels(id),
      listMembers(id),
    ]);
    await Promise.all([
      ...tasks.map((t) => deleteRecord(COL.boardTasks, t.id)),
      ...states.map((s) => deleteRecord(COL.boardStates, s.id)),
      ...labels.map((l) => deleteRecord(COL.boardLabels, l.id)),
      ...members.map((m) => deleteRecord(COL.boardMembers, m.id)),
    ]);
    // 最后软删项目本身（软删写 deleted_at，不走 PB 物理删除故不触发 cascade）
    await deleteRecord(COL.boardProjects, id);
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      // 若删的是当前打开项目，清空工作区状态
      ...(s.openedProjectId === id
        ? { openedProjectId: null, states: [], labels: [], tasks: [] }
        : {}),
    }));
  },
}));
