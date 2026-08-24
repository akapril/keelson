// StatusColumn —— 看板列（视觉移植自 workavera status-column，绑定我们的类型）。
import { memo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ArchiveArrowDownIcon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBoardStore } from "@/store/board";
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
  /** 一键归档本列全部（未归档）任务——仅完成类别列展示入口。 */
  onArchiveColumn?: (stateId: string) => void;
  /** 内联快速加任务（输入标题即建、连续录入）。仅非泳道、非多选路径传入；不传则不渲染 composer。 */
  onQuickAdd?: (stateId: string, title: string) => Promise<void>;
}

/**
 * 列内联「快速加任务」：折叠态为一个「+ 添加」按钮，点开就地输标题，
 * Enter 建成并清空续输（保留焦点连续录入），Esc / 失焦空值收起。复杂编辑仍点卡片进 TaskSheet。
 */
function QuickAdd({
  stateId,
  onAdd,
}: {
  stateId: string;
  onAdd: (stateId: string, title: string) => Promise<void>;
}) {
  const { t } = useTranslation("board");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const v = title.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      await onAdd(stateId, v);
      setTitle(""); // 清空续输，保留焦点
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-3.5" />
        {t("task.addTask")}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      autoFocus
      value={title}
      disabled={busy}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => {
        // Enter 提交（避开中文输入法组合态）；Esc 收起
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          void submit();
        } else if (e.key === "Escape") {
          setTitle("");
          setOpen(false);
        }
      }}
      // 失焦且无输入才收起（有内容时保留，避免误触丢失）
      onBlur={() => {
        if (!title.trim()) setOpen(false);
      }}
      placeholder={t("sheet.titlePlaceholder")}
      className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
    />
  );
}

/**
 * 单状态列：useDroppable(id="state:<id>") + SortableContext。
 * 列头：颜色点 + 名称 + 计数 + 加号按钮；空列显示"添加任务"占位按钮。
 * 多选模式：将 selectMode/selected/onToggleSelect/onEnterSelect 透传给 TaskCard。
 */
function StatusColumnInner({
  state,
  tasks,
  onAddTask,
  onEditTask,
  selectMode,
  selected,
  onToggleSelect,
  onEnterSelect,
  onArchiveColumn,
  onQuickAdd,
}: StatusColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `state:${state.id}`,
    data: { type: "state", stateId: state.id },
  });

  // 每列订阅一次 labels/states 传给卡片，取代原来每张卡各自订阅整个数组
  // （100 卡 = 200 次 selector 求值/次 board 变更 → 降到每列一次）。
  const labels = useBoardStore((s) => s.labels);
  const states = useBoardStore((s) => s.states);
  const { t } = useTranslation("board");

  // 完成类别列 + 当前有未归档任务 → 显示「一键归档已完成」入口
  const canArchiveColumn =
    state.category === "completed" &&
    !!onArchiveColumn &&
    tasks.some((t) => !t.archived);

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
        <div className="flex shrink-0 items-center">
          {canArchiveColumn && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onArchiveColumn!(state.id)}
              title={t("column.archiveAllTitle")}
              aria-label={t("column.archiveAllAriaLabel", { name: state.name })}
            >
              <HugeiconsIcon icon={ArchiveArrowDownIcon} strokeWidth={2} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onAddTask(state.id)}
            aria-label={t("column.addTaskAriaLabel", { name: state.name })}
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          </Button>
        </div>
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
              labels={labels}
              states={states}
              onEdit={onEditTask}
              selectMode={selectMode}
              selected={selected?.has(task.id)}
              onToggleSelect={onToggleSelect}
              onEnterSelect={onEnterSelect}
            />
          ))}
        </SortableContext>

        {/* 内联快速加任务：composer 启用（非泳道、非多选）时渲染，空列也由它承载「添加」入口 */}
        {onQuickAdd && !selectMode ? (
          <QuickAdd stateId={state.id} onAdd={onQuickAdd} />
        ) : (
          // 无 composer 时保留原空列占位（点击开 TaskSheet）
          tasks.length === 0 && (
            <button
              type="button"
              onClick={() => onAddTask(state.id)}
              className="flex flex-1 items-center justify-center rounded-lg border border-dashed py-4 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {t("task.addTask")}
            </button>
          )
        )}
      </div>
    </div>
  );
}

// memo：仅当列的 state/tasks/选中态/回调变化才重渲。
// 拖拽(activeTask)、注入状态、面板开关等 KanbanBoard 局部状态变化不再级联到未变的列。
// 依赖父层传稳定回调（KanbanBoard 已用 useCallback + getState）。
export const StatusColumn = memo(StatusColumnInner);
