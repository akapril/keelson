// KanbanBoard —— 已打开项目的拖拽看板（纯看板；git 状态/关联会话由 ProjectWorkspace 承载）。
import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useBoardStore } from "@/store/board";
import type { BoardTask } from "@/types/board";
import { StatusColumn } from "./StatusColumn";
import { TaskCard } from "./TaskCard";
import { TaskSheet } from "./TaskSheet";

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
 */
export function KanbanBoard() {
  const states = useBoardStore((s) => s.states);
  const tasks = useBoardStore((s) => s.tasks);
  const tasksByState = useBoardStore((s) => s.tasksByState);
  const moveTask = useBoardStore((s) => s.moveTask);
  const openedProjectId = useBoardStore((s) => s.openedProjectId);

  // 当前正在拖拽的任务（用于 DragOverlay）
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null);

  // TaskSheet 受控状态（新建/编辑任务）
  const [sheet, setSheet] = useState<SheetState>({
    open: false,
    mode: "create",
  });

  // PointerSensor，激活约束：移动 6px 后才开始拖拽（防止误触点击）
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const dragged = tasks.find((t) => t.id === event.active.id);
    setActiveTask(dragged ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);
    if (!over) return;

    const dragged = tasks.find((t) => t.id === active.id);
    if (!dragged) return;

    // 解析目标状态 ID（over 可能是 state droppable 或 task sortable）
    let targetStateId: string | undefined;
    const overId = String(over.id);

    if (overId.startsWith("state:")) {
      targetStateId = overId.slice("state:".length);
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      targetStateId = overTask?.state;
    }

    if (!targetStateId) return;

    // 目标列的任务（排除被拖拽任务，保持排序）
    const targetTasks = (tasksByState()[targetStateId] ?? []).filter(
      (t) => t.id !== dragged.id,
    );

    // 计算插入位置 index
    let toIndex: number;
    if (overId.startsWith("state:")) {
      toIndex = targetTasks.length;
    } else {
      const overIndex = targetTasks.findIndex((t) => t.id === overId);
      toIndex = overIndex >= 0 ? overIndex : targetTasks.length;
    }

    void moveTask(dragged.id, targetStateId, Math.max(0, toIndex)).catch(
      () => {},
    );
  };

  const sortedStates = [...states].sort((a, b) => a.sort_order - b.sort_order);
  const grouped = tasksByState();

  if (!openedProjectId) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveTask(null)}
      >
        {/* 横向滚动的看板列容器 */}
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-4">
          {sortedStates.map((state) => (
            <StatusColumn
              key={state.id}
              state={state}
              tasks={grouped[state.id] ?? []}
              onAddTask={(stateId) =>
                setSheet({ open: true, mode: "create", stateId })
              }
              onEditTask={(task) => setSheet({ open: true, mode: "edit", task })}
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
