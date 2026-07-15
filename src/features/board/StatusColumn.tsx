// StatusColumn —— 看板列：可拖放目标 + 有序任务卡片列表。
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { BoardState, BoardTask } from "../../types/board";
import { TaskCard } from "./TaskCard";

interface StatusColumnProps {
  state: BoardState;
  tasks: BoardTask[];
  /** 点击"+ 任务"在本列新建任务（预填 state）。 */
  onAddTask: (stateId: string) => void;
  /** 点击任务卡片进入编辑。 */
  onEditTask: (task: BoardTask) => void;
}

/**
 * 单状态列：
 * - useDroppable id 为 "state:<stateId>"（同 workavera 惯例）
 * - SortableContext（vertical）包裹 TaskCard 列表
 * - 列头颜色点使用 inline style（用户数据颜色）
 * - "+ 任务"按钮由 Task 9（TaskSheet）实现，此处占位
 */
export function StatusColumn({
  state,
  tasks,
  onAddTask,
  onEditTask,
}: StatusColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `state:${state.id}`,
    data: { type: "state", stateId: state.id },
  });

  return (
    <div className="flex w-72 shrink-0 flex-col">
      {/* 列头：颜色点 + 名称 + 任务计数 */}
      <div className="mb-2 flex items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: state.color }}
        />
        <span className="flex-1 truncate text-sm font-semibold text-foreground">
          {state.name}
        </span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
          {tasks.length}
        </span>
      </div>

      {/* 任务列表（可接收拖入） */}
      <div
        ref={setNodeRef}
        className={[
          "flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto rounded-xl p-2 transition-colors",
          "max-h-[calc(100vh-16rem)] bg-muted/30",
          isOver ? "bg-primary/5 ring-1 ring-primary/20" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onEdit={onEditTask} />
          ))}
        </SortableContext>

        {/* 空列占位 */}
        {tasks.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed py-4">
            <span className="text-xs text-muted-foreground">暂无任务</span>
          </div>
        )}
      </div>

      {/* "+ 任务"按钮：在本列新建任务（预填当前 state） */}
      <button
        type="button"
        onClick={() => onAddTask(state.id)}
        className={[
          "mt-2 w-full rounded-lg border border-dashed py-1.5 text-xs",
          "text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring",
        ].join(" ")}
        title="新建任务"
      >
        + 任务
      </button>
    </div>
  );
}
