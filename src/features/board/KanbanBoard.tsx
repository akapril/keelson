// KanbanBoard —— 已打开项目的拖拽看板（纯看板；git 状态/关联会话由 ProjectWorkspace 承载）。
import { useState, useCallback, useEffect, useRef } from "react";
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
import { useBoardStore } from "@/store/board";
import type { BoardTask, TaskPriority } from "@/types/board";
import { StatusColumn } from "./StatusColumn";
import { TaskCard } from "./TaskCard";
import { TaskSheet } from "./TaskSheet";
import { BatchActionBar } from "./BatchActionBar";
import {
  tasksToAutoArchive,
  getAutoArchiveDays,
  archivableInState,
} from "./task-archive";

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
  const tasksByState = useBoardStore((s) => s.tasksByState);
  const moveTask = useBoardStore((s) => s.moveTask);
  const previewMove = useBoardStore((s) => s.previewMove);
  const updateTask = useBoardStore((s) => s.updateTask);
  const deleteTask = useBoardStore((s) => s.deleteTask);
  const openedProjectId = useBoardStore((s) => s.openedProjectId);

  // 当前正在拖拽的任务（用于 DragOverlay）
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null);
  // 是否显示已归档任务（默认隐藏，保持看板清爽）
  const [showArchived, setShowArchived] = useState(false);
  // 自动归档只对每个项目跑一次（避免重复写库）
  const autoArchivedFor = useRef<string | null>(null);

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
    const targetTasks = (tasksByState()[targetStateId] ?? []).filter(
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
    if (!over) return;
    const r = resolveDrop(String(active.id), String(over.id));
    if (!r) return;
    // 落手：持久化最终位置（previewMove 已将卡片放到位，此处计算最终 index 落库）
    void moveTask(r.dragged.id, r.targetStateId, r.toIndex).catch(() => {});
  };

  const sortedStates = [...states].sort((a, b) => a.sort_order - b.sort_order);
  const grouped = tasksByState();
  // 默认隐藏归档任务；开关打开时才显示。每列按此过滤。
  const visibleOf = (stateId: string) =>
    (grouped[stateId] ?? []).filter((t) => showArchived || !t.archived);
  const archivedCount = tasks.filter((t) => t.archived).length;

  // 一键归档某列全部未归档任务
  const archiveColumn = (stateId: string) => {
    const ids = archivableInState(tasks, stateId);
    if (ids.length === 0) return;
    void Promise.allSettled(ids.map((id) => updateTask(id, { archived: true }))).then(
      (rs) => {
        const ok = rs.filter((r) => r.status === "fulfilled").length;
        if (ok > 0) toast.success(`已归档 ${ok} 个任务`);
        if (ok < ids.length) toast.error(`${ids.length - ok} 个归档失败`);
      },
    );
  };

  if (!openedProjectId) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具条：显示/隐藏归档（仅当存在归档任务时出现） */}
      {archivedCount > 0 && (
        <div className="flex shrink-0 items-center justify-end pb-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {showArchived ? "隐藏归档" : `显示归档（${archivedCount}）`}
          </button>
        </div>
      )}
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
              tasks={visibleOf(state.id)}
              onAddTask={(stateId) =>
                setSheet({ open: true, mode: "create", stateId })
              }
              onEditTask={(task) => setSheet({ open: true, mode: "edit", task })}
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
              <TaskCard task={activeTask} />
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
