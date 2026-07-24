// KanbanBoard —— 已打开项目的拖拽看板（纯看板；git 状态/关联会话由 ProjectWorkspace 承载）。
import { useState, useCallback, useDeferredValue, useEffect, useRef, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, FilterIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { useBoardStore, groupTasksByState } from "@/store/board";
import { ipc } from "@/lib/tauri/ipc";
import { isCliSynced, getInjectSet } from "./cli-task-source";
import type { BoardTask, TaskPriority } from "@/types/board";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { StatusColumn } from "./StatusColumn";
import { TaskCard } from "./TaskCard";
import { TaskSheet } from "./TaskSheet";
import { BatchActionBar } from "./BatchActionBar";
import { PRIORITY_ORDER, PRIORITY_META } from "./board-meta";
import {
  tasksToAutoArchive,
  getAutoArchiveDays,
  archivableInState,
} from "./task-archive";
import {
  taskMatchesFilter,
  isFilterActive,
  EMPTY_FILTER,
  type TaskFilter,
} from "./task-filter";

// TaskSheet 的受控状态：新建（预填 state）或编辑（携带 task）。
interface SheetState {
  open: boolean;
  mode: "create" | "edit";
  stateId?: string;
  task?: BoardTask;
}

/**
 * 看板视图：DndContext（PointerSensor 距离 6px）+ 按 sort_order 渲染 StatusColumn；
 * onDragEnd 解析目标 state + index → moveTask；DragOverlay 渲染幽灵卡片。
 *
 * 多选：selectMode + selected(Set<string>) 持有在此层，经 StatusColumn 透传到 TaskCard。
 * 批量操作栏 BatchActionBar 在选中 >0 时浮现于底部。
 */
export function KanbanBoard() {
  const states = useBoardStore((s) => s.states);
  const tasks = useBoardStore((s) => s.tasks);
  const labels = useBoardStore((s) => s.labels);
  const projects = useBoardStore((s) => s.projects);
  const moveTask = useBoardStore((s) => s.moveTask);
  const previewMove = useBoardStore((s) => s.previewMove);
  const updateTask = useBoardStore((s) => s.updateTask);
  const deleteTask = useBoardStore((s) => s.deleteTask);
  const openedProjectId = useBoardStore((s) => s.openedProjectId);

  // 当前正在拖拽的任务（用于 DragOverlay）
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null);
  // 是否显示已归档任务（默认隐藏，保持看板清爽）
  const [showArchived, setShowArchived] = useState(false);
  // 任务筛选：文本 + 标签 + 优先级
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_FILTER);
  // CLI 注入状态（常驻显示"注了没/几条"）；null=未查/无仓库
  const [injectStatus, setInjectStatus] = useState<{ count: number } | null>(null);
  // 自动归档只对每个项目跑一次（避免重复写库）
  const autoArchivedFor = useRef<string | null>(null);

  // 派生数据 memo 化：避免搜索框每次击键都全量重排/重分组/重过滤。
  // sortedStates 随 states 变；grouped 随 tasks 变；visibleByState 再叠加归档可见性 + 筛选。
  const sortedStates = useMemo(
    () => [...states].sort((a, b) => a.sort_order - b.sort_order),
    [states],
  );
  // 每列按 rank 升序：previewMove 只改 rank 不移动数组元素，若渲染沿用数组原序，
  // 列内拖拽后卡片会「弹回原位」(rank 变了但显示顺序没变)。必须在此按 rank 排，
  // 让显示顺序始终反映 rank —— 列内拖拽排序才生效。
  const grouped = useMemo(() => {
    const g = groupTasksByState(tasks);
    for (const k of Object.keys(g)) {
      g[k] = g[k].slice().sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    }
    return g;
  }, [tasks]);
  // 搜索/筛选用「延迟值」：输入框由 filter(即时)驱动保持跟手，而重量级的
  // 按列过滤 + 所有列/卡重渲用 deferredFilter，在低优先级下进行，不阻塞击键。
  const deferredFilter = useDeferredValue(filter);
  const visibleByState = useMemo(() => {
    const map: Record<string, BoardTask[]> = {};
    for (const st of sortedStates) {
      map[st.id] = (grouped[st.id] ?? []).filter(
        (t) => (showArchived || !t.archived) && taskMatchesFilter(t, deferredFilter),
      );
    }
    return map;
  }, [sortedStates, grouped, showArchived, deferredFilter]);

  // 自动归档：进入项目、任务加载后，把「完成超过 N 天」的任务自动归档（阈值可在设置改，0=关）。
  useEffect(() => {
    if (!openedProjectId || tasks.length === 0 || states.length === 0) return;
    if (autoArchivedFor.current === openedProjectId) return;
    autoArchivedFor.current = openedProjectId;
    const days = getAutoArchiveDays();
    const ids = tasksToAutoArchive(tasks, states, days, Date.now());
    if (ids.length === 0) return;
    void Promise.allSettled(ids.map((id) => updateTask(id, { archived: true }))).then(
      (rs) => {
        // 只按实际成功的条数提示（写库失败时不误报，如迁移未应用/PB 不可用）
        const ok = rs.filter((r) => r.status === "fulfilled").length;
        if (ok > 0) toast.message(`已自动归档 ${ok} 个完成超过 ${days} 天的任务`);
      },
    );
  }, [openedProjectId, tasks, states, updateTask]);

  // TaskSheet 受控状态（新建/编辑任务）
  const [sheet, setSheet] = useState<SheetState>({
    open: false,
    mode: "create",
  });

  // 传给列/卡的稳定回调（useCallback）——否则 memo 的 StatusColumn/TaskCard 会被
  // 每次新建的内联箭头函数击穿，失去 memo 意义。
  const openCreate = useCallback(
    (stateId: string) => setSheet({ open: true, mode: "create", stateId }),
    [],
  );
  const openEdit = useCallback(
    (task: BoardTask) => setSheet({ open: true, mode: "edit", task }),
    [],
  );

  // ── 多选状态 ─────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 切换项目时退出多选，清空选中
  useEffect(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, [openedProjectId]);

  // 进入多选模式（右键"选择"）：同时将该卡片设为已选
  const handleEnterSelect = useCallback((taskId: string) => {
    setSelectMode(true);
    setSelected(new Set([taskId]));
  }, []);

  // 切换单个卡片的勾选状态
  const handleToggleSelect = useCallback((taskId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  // 退出多选模式，清空选中
  const handleExitSelect = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  // ── 批量移动 ─────────────────────────────────────────────────
  const handleBatchMove = useCallback(
    async (toStateId: string) => {
      const ids = [...selected];
      let successCount = 0;
      const errors: string[] = [];
      for (const id of ids) {
        try {
          // 追加到目标列末尾（当前目标列任务数作为 toIndex）
          const toIndex = tasks.filter((t) => t.state === toStateId).length;
          await moveTask(id, toStateId, toIndex);
          successCount++;
        } catch (e) {
          errors.push(String(e));
        }
      }
      if (errors.length > 0) {
        toast.error(`批量移动部分失败（${successCount}/${ids.length} 成功）`);
      } else {
        const stateName =
          states.find((s) => s.id === toStateId)?.name ?? toStateId;
        toast.success(`已将 ${successCount} 项任务移动至「${stateName}」`);
      }
      handleExitSelect();
    },
    [selected, tasks, moveTask, states, handleExitSelect],
  );

  // ── 批量改优先级 ──────────────────────────────────────────────
  const handleBatchPriority = useCallback(
    async (priority: TaskPriority) => {
      const ids = [...selected];
      let successCount = 0;
      const errors: string[] = [];
      for (const id of ids) {
        try {
          await updateTask(id, { priority });
          successCount++;
        } catch (e) {
          errors.push(String(e));
        }
      }
      if (errors.length > 0) {
        toast.error(
          `批量改优先级部分失败（${successCount}/${ids.length} 成功）`,
        );
      } else {
        toast.success(`已将 ${successCount} 项任务优先级设为「${priority}」`);
      }
      handleExitSelect();
    },
    [selected, updateTask, handleExitSelect],
  );

  // ── 批量删除 ─────────────────────────────────────────────────
  const handleBatchDelete = useCallback(async () => {
    const ids = [...selected];
    let successCount = 0;
    const errors: string[] = [];
    for (const id of ids) {
      try {
        await deleteTask(id);
        successCount++;
      } catch (e) {
        errors.push(String(e));
      }
    }
    if (errors.length > 0) {
      toast.error(`批量删除部分失败（${successCount}/${ids.length} 成功）`);
    } else {
      toast.success(`已删除 ${successCount} 项任务`);
    }
    handleExitSelect();
  }, [selected, deleteTask, handleExitSelect]);

  // PointerSensor，激活约束：移动 6px 后才开始拖拽（防止误触点击）
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const dragged = tasks.find((t) => t.id === event.active.id);
    setActiveTask(dragged ?? null);
  };

  // 解析拖拽落点：目标状态列 + 插入位置（onDragOver / onDragEnd 共用）。
  // over 可能是 state droppable（"state:<id>"）或某个 task sortable（task.id）。
  const resolveDrop = (activeId: string, overId: string) => {
    const dragged = tasks.find((t) => t.id === activeId);
    if (!dragged) return null;

    let targetStateId: string | undefined;
    if (overId.startsWith("state:")) {
      targetStateId = overId.slice("state:".length);
    } else {
      targetStateId = tasks.find((t) => t.id === overId)?.state;
    }
    if (!targetStateId) return null;

    // 目标列任务（排除被拖拽任务本身，保持排序）
    const targetTasks = (grouped[targetStateId] ?? []).filter(
      (t) => t.id !== dragged.id,
    );
    let toIndex: number;
    if (overId.startsWith("state:")) {
      toIndex = targetTasks.length;
    } else {
      const overIndex = targetTasks.findIndex((t) => t.id === overId);
      toIndex = overIndex >= 0 ? overIndex : targetTasks.length;
    }

    return { dragged, targetStateId, toIndex: Math.max(0, toIndex) };
  };

  // 拖动中：跨列悬停时把卡片实时移入目标列（仅本地预览，不落库）。
  // 列内重排由 sortable 视觉呈现，故此处只处理跨列，避免同列 rank 抖动。
  const handleDragOver = (event: DragOverEvent) => {
    // 筛选生效时列内为子集，拖拽落位会错乱 → 禁用重排（先清除筛选再拖）
    if (isFilterActive(filter)) return;
    const { active, over } = event;
    if (!over) return;
    const r = resolveDrop(String(active.id), String(over.id));
    if (!r) return;
    if (r.dragged.state !== r.targetStateId) {
      previewMove(r.dragged.id, r.targetStateId, r.toIndex);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);
    if (isFilterActive(filter)) return; // 筛选态不落库重排
    if (!over) return;
    const r = resolveDrop(String(active.id), String(over.id));
    if (!r) return;
    // 落手：持久化最终位置（previewMove 已将卡片放到位，此处计算最终 index 落库）
    void moveTask(r.dragged.id, r.targetStateId, r.toIndex).catch((e) =>
      toast.error(`移动失败：${String(e)}`),
    );
  };

  const archivedCount = tasks.filter((t) => t.archived).length;
  const filterOn = isFilterActive(filter);

  // 一键归档某列全部未归档任务（useCallback 稳定：tasks 按需 getState 读，不进依赖）
  const archiveColumn = useCallback(
    (stateId: string) => {
      const ids = archivableInState(useBoardStore.getState().tasks, stateId);
      if (ids.length === 0) return;
      void Promise.allSettled(ids.map((id) => updateTask(id, { archived: true }))).then(
        (rs) => {
          const ok = rs.filter((r) => r.status === "fulfilled").length;
          if (ok > 0) toast.success(`已归档 ${ok} 个任务`);
          if (ok < ids.length) toast.error(`${ids.length - ok} 个归档失败`);
        },
      );
    },
    [updateTask],
  );

  // 当前项目的仓库路径（注入依据 + 状态查询）
  const repoPath = projects.find((p) => p.id === openedProjectId)?.repo_path;

  // 进项目 / 切项目时查一次注入状态（有仓库才查）
  useEffect(() => {
    if (!repoPath) {
      setInjectStatus(null);
      return;
    }
    let cancelled = false;
    void ipc
      .tasksProjectFilesStatus(repoPath)
      .then((s) => {
        if (!cancelled) setInjectStatus(s.claude_md || s.agents_md ? { count: s.count } : null);
      })
      .catch(() => {
        if (!cancelled) setInjectStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  // 注入/清空后刷新状态
  const refreshInjectStatus = () => {
    if (!repoPath) return;
    void ipc
      .tasksProjectFilesStatus(repoPath)
      .then((s) => setInjectStatus(s.claude_md || s.agents_md ? { count: s.count } : null))
      .catch(() => {});
  };

  // 看板 → CLI：把任务写进 <repo>/CLAUDE.md+AGENTS.md 的受管块，
  // 让在该仓库起的 CLI 会话(Claude 读 CLAUDE.md / Codex 读 AGENTS.md)看到任务清单。
  // 仅自建任务（排除 CLI 同步来的，避免注回自己）；scope="set" 只注入注入集，"all" 注入全部自建。
  const injectToCli = async (scope: "set" | "all" | "clear") => {
    const project = projects.find((p) => p.id === openedProjectId);
    if (!project?.repo_path) {
      toast.error("本项目未绑定仓库路径，无法注入（先在项目设置里绑定仓库）");
      return;
    }
    // 清空：写空列表 = 卸载受管块（块外内容保留）
    if (scope === "clear") {
      try {
        await ipc.tasksWriteProjectFiles(project.repo_path, []);
        toast.success("已清空 CLI 注入块（CLAUDE.md / AGENTS.md）");
        refreshInjectStatus();
      } catch (e) {
        toast.error(`清空失败：${String(e)}`);
      }
      return;
    }
    const stateById = new Map(states.map((s) => [s.id, s]));
    const injectSet = getInjectSet(project.id);
    const chosen = tasks.filter((t) => {
      if (t.archived || isCliSynced(t)) return false; // 排除归档 + CLI 同步来的
      return scope === "all" || injectSet.has(t.id);
    });
    if (chosen.length === 0) {
      toast.message(
        scope === "set"
          ? "注入集为空——右键自建任务「加入 CLI 注入集」"
          : "没有可注入的自建任务",
      );
      return;
    }
    const lines = chosen.map((t) => {
      const st = stateById.get(t.state);
      return { title: t.title, done: st?.category === "completed", hint: st?.name ?? "" };
    });
    try {
      const written = await ipc.tasksWriteProjectFiles(project.repo_path, lines);
      toast.success(`已注入 ${lines.length} 个任务到 ${written.length} 个文件（CLAUDE.md / AGENTS.md）`);
      refreshInjectStatus();
    } catch (e) {
      toast.error(`注入失败：${String(e)}`);
    }
  };

  if (!openedProjectId) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具条：搜索 + 标签/优先级筛选 + 清除 + 显示归档 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
        <div className="relative min-w-40 flex-1 sm:max-w-xs">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={filter.query}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
            placeholder="搜索任务（标题 + 描述）…"
            className="h-8 pl-8 text-sm"
          />
        </div>

        {/* 标签筛选 */}
        {labels.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs transition-colors",
                  filter.labels.length > 0
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                <HugeiconsIcon icon={FilterIcon} strokeWidth={2} className="size-3.5" />
                标签{filter.labels.length > 0 ? `（${filter.labels.length}）` : ""}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 w-52 overflow-y-auto">
              <DropdownMenuLabel>按标签筛选</DropdownMenuLabel>
              {labels.map((l) => (
                <DropdownMenuCheckboxItem
                  key={l.id}
                  checked={filter.labels.includes(l.id)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() =>
                    setFilter((f) => ({
                      ...f,
                      labels: f.labels.includes(l.id)
                        ? f.labels.filter((x) => x !== l.id)
                        : [...f.labels, l.id],
                    }))
                  }
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
                  <span className="truncate">{l.name}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* 优先级筛选 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs transition-colors",
                filter.priority
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {filter.priority ? PRIORITY_META[filter.priority].label : "优先级"}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuRadioGroup
              value={filter.priority ?? "__all"}
              onValueChange={(v) =>
                setFilter((f) => ({ ...f, priority: v === "__all" ? null : (v as TaskPriority) }))
              }
            >
              <DropdownMenuRadioItem value="__all">全部优先级</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {PRIORITY_ORDER.map((p) => (
                <DropdownMenuRadioItem key={p} value={p}>
                  <span className={cn("size-1.5 rounded-full", PRIORITY_META[p].dot)} />
                  {PRIORITY_META[p].label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {filterOn && (
          <button
            type="button"
            onClick={() => setFilter(EMPTY_FILTER)}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
            清除
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* 看板→CLI：注入自建任务到 repo 的 CLAUDE.md/AGENTS.md（注入集 / 全部自建） */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="把自建任务写进仓库 CLAUDE.md/AGENTS.md 的受管块，让 CLI 会话看到（CLI 同步来的任务不注入）"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                  injectStatus
                    ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                    : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                注入到 CLI
                {/* 常驻状态：已注入显示条数（含 ✓），未注入不显示——一眼知道注了没 */}
                {injectStatus && (
                  <span className="rounded-full bg-primary/20 px-1.5 text-[10px] tabular-nums">
                    ✓{injectStatus.count}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>注入自建任务到 CLI</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void injectToCli("set")}>
                注入选中（注入集）
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void injectToCli("all")}>
                注入全部自建任务
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void injectToCli("clear")}>
                清空注入块
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {archivedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {showArchived ? "隐藏归档" : `显示归档（${archivedCount}）`}
            </button>
          )}
        </div>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveTask(null)}
      >
        {/* 横向滚动的看板列容器 */}
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-4">
          {sortedStates.map((state) => (
            <StatusColumn
              key={state.id}
              state={state}
              tasks={visibleByState[state.id] ?? []}
              onAddTask={openCreate}
              onEditTask={openEdit}
              selectMode={selectMode}
              selected={selected}
              onToggleSelect={handleToggleSelect}
              onEnterSelect={handleEnterSelect}
              onArchiveColumn={archiveColumn}
            />
          ))}

          {sortedStates.length === 0 && (
            <div className="flex min-h-48 flex-1 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              此项目暂无状态列 —— 打开「项目设置」添加
            </div>
          )}
        </div>

        {/* 拖拽幽灵：跟随光标，旋转 3° 半透明显示 */}
        <DragOverlay>
          {activeTask ? (
            <div className="w-72 rotate-3 opacity-80">
              <TaskCard task={activeTask} labels={labels} states={states} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* 批量操作栏：多选模式且已选 >0 时浮现于底部 */}
      {selectMode && selected.size > 0 && (
        <BatchActionBar
          selectedCount={selected.size}
          states={sortedStates}
          onMove={handleBatchMove}
          onPriority={handleBatchPriority}
          onDelete={handleBatchDelete}
          onExit={handleExitSelect}
        />
      )}

      {/* 任务新建/编辑面板（受控） */}
      <TaskSheet
        open={sheet.open}
        mode={sheet.mode}
        stateId={sheet.stateId}
        task={sheet.task}
        onClose={() => setSheet((s) => ({ ...s, open: false }))}
      />
    </div>
  );
}
