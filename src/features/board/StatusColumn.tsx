// StatusColumn —— 看板列（视觉移植自 workavera status-column，绑定我们的类型）。
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BoardState, BoardTask } from "@/types/board";
import { TaskCard } from "./TaskCard";

interface StatusColumnProps {
  state: BoardState;
  tasks: BoardTask[];
  /** 点击"+"在本列新建任务（预填 state）。 */
  onAddTask: (stateId: string) => void;
  /** 点击任务卡片进入编辑。 */
  onEditTask: (task: BoardTask) => void;
  /** 当前是否处于多选模式。 */
  selectMode?: boolean;
  /** 当前已选任务 ID 集合（多选模式下）。 */
  selected?: Set<string>;
  /** 切换单个任务的勾选状态。 */
  onToggleSelect?: (taskId: string) => void;
  /** 进入多选模式（右键"选择"）。 */
  onEnterSelect?: (taskId: string) => void;
}

/**
 * 单状态列：useDroppable(id="state:<id>") + SortableContext。
 * 列头：颜色点 + 名称 + 计数 + 加号按钮；空列显示"添加任务"占位按钮。
 * 多选模式：将 selectMode/selected/onToggleSelect/onEnterSelect 透传给 TaskCard。
 */
export function StatusColumn({
  state,
  tasks,
  onAddTask,
  onEditTask,
  selectMode,
  selected,
  onToggleSelect,
  onEnterSelect,
}: StatusColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `state:${state.id}`,
    data: { type: "state", stateId: state.id },
  });

  return (
    <div className="flex w-72 shrink-0 flex-col">
      {/* 列头 */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: state.color }}
          />
          <span className="truncate text-sm font-semibold text-foreground">
            {state.name}
          </span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
            {tasks.length}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onAddTask(state.id)}
          aria-label={`向「${state.name}」添加任务`}
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
        </Button>
      </div>

      {/* 任务列表（可接收拖入） */}
      <div
        ref={setNodeRef}
        className={cn(
          "no-scrollbar flex max-h-[calc(100vh-16rem)] min-h-24 flex-1 flex-col gap-2 overflow-y-auto rounded-xl bg-muted/30 p-2 transition-colors",
          isOver && "bg-primary/5 ring-1 ring-primary/20",
        )}
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onEdit={onEditTask}
              selectMode={selectMode}
              selected={selected?.has(task.id)}
              onToggleSelect={onToggleSelect}
              onEnterSelect={onEnterSelect}
            />
          ))}
        </SortableContext>

        {/* 空列占位（点击即新建） */}
        {tasks.length === 0 && (
          <button
            type="button"
            onClick={() => onAddTask(state.id)}
            className="flex flex-1 items-center justify-center rounded-lg border border-dashed py-4 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            + 添加任务
          </button>
        )}
      </div>
    </div>
  );
}
