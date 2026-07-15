// KanbanBoard —— 已打开项目的拖拽看板视图。
import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useBoardStore } from "../../store/board";
import type { BoardTask } from "../../types/board";
import { StatusColumn } from "./StatusColumn";
import { TaskCard } from "./TaskCard";

/**
 * 看板视图：
 * - DndContext（PointerSensor，激活距离 6px）
 * - 按 sort_order 渲染 StatusColumn
 * - onDragEnd 解析目标 state + index → moveTask
 * - DragOverlay 在拖拽时渲染幽灵卡片
 */
export function KanbanBoard() {
  const states = useBoardStore((s) => s.states);
  const tasks = useBoardStore((s) => s.tasks);
  const tasksByState = useBoardStore((s) => s.tasksByState);
  const moveTask = useBoardStore((s) => s.moveTask);
  const openedProjectId = useBoardStore((s) => s.openedProjectId);

  // 当前正在拖拽的任务（用于 DragOverlay）
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null);

  // PointerSensor，激活约束：移动 6px 后才开始拖拽（防止误触点击）
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // 拖拽开始：记录活跃任务
  const handleDragStart = (event: DragStartEvent) => {
    const dragged = tasks.find((t) => t.id === event.active.id);
    setActiveTask(dragged ?? null);
  };

  // 拖拽结束：解析目标 state + 插入位置 → moveTask
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
      // 拖到列的空白区域
      targetStateId = overId.slice("state:".length);
    } else {
      // 拖到另一个任务卡片上，取该任务的 state
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
      // 拖到列空白区：放到末尾
      toIndex = targetTasks.length;
    } else {
      // 拖到任务上：插入到该任务之前
      const overIndex = targetTasks.findIndex((t) => t.id === overId);
      toIndex = overIndex >= 0 ? overIndex : targetTasks.length;
    }

    void moveTask(dragged.id, targetStateId, Math.max(0, toIndex)).catch(
      () => {},
    );
  };

  // 当前打开的项目的状态列（已按 sort_order 排序）
  const sortedStates = [...states].sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  const grouped = tasksByState();

  if (!openedProjectId) return null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveTask(null)}
    >
      {/* 横向滚动的看板列容器 */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {sortedStates.map((state) => (
          <StatusColumn
            key={state.id}
            state={state}
            tasks={grouped[state.id] ?? []}
          />
        ))}

        {sortedStates.length === 0 && (
          <div className="flex min-h-48 flex-1 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
            此项目暂无状态列
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
  );
}
