// TaskCard —— 看板单任务卡片（视觉移植自 workavera todo-card，绑定我们的 store/类型）。
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar03Icon,
  TextAlignLeftIcon,
  Message01Icon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useBoardStore } from "@/store/board";
import type { BoardTask } from "@/types/board";
import { PRIORITY_META } from "./board-meta";

// ── 日期格式化 ────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

function isOverdue(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr) < today;
}

interface TaskCardProps {
  task: BoardTask;
  /** 点击卡片进入编辑（拖拽激活距离 6px，纯点击不会触发拖拽）。 */
  onEdit?: (task: BoardTask) => void;
}

/**
 * 可拖拽任务卡片：标签 chip / 标题 / 描述指示 / 优先级徽章 / 截止日期 / 来源会话徽章。
 * inline style 仅用于用户数据颜色（label.color）与 dnd transform。
 */
export function TaskCard({ task, onEdit }: TaskCardProps) {
  const labels = useBoardStore((s) => s.labels);
  const navigate = useNavigate();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: "task", stateId: task.state },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  // 点击"来源会话"徽章：跳转到会话中枢，携带会话 id 作为定位信号。
  function handleSourceClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!task.source_session_id) return;
    const params = new URLSearchParams({ session: task.source_session_id });
    if (task.source_provider) params.set("provider", task.source_provider);
    navigate(`/sessions?${params.toString()}`);
  }

  const taskLabels = labels.filter((l) => task.labels?.includes(l.id));
  const priority = PRIORITY_META[task.priority];
  const overdue = task.due_date ? isOverdue(task.due_date) : false;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onEdit?.(task)}
      className={cn(
        "group/card cursor-pointer rounded-xl border border-border/60 bg-card p-3 shadow-sm transition-all hover:border-border hover:shadow-md",
        isDragging && "opacity-50 shadow-lg ring-2 ring-primary/20",
      )}
    >
      {/* 标签 chips（颜色来自用户数据，inline style） */}
      {taskLabels.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {taskLabels.map((label) => (
            <span
              key={label.id}
              className="inline-flex h-4.5 items-center rounded-md px-1.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: label.color }}
            >
              {label.name}
            </span>
          ))}
        </div>
      )}

      {/* 标题 */}
      <p className="text-sm font-medium leading-snug text-foreground">
        {task.title}
      </p>

      {/* 描述指示 */}
      {task.description && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <HugeiconsIcon
            icon={TextAlignLeftIcon}
            strokeWidth={2}
            className="size-3 shrink-0"
          />
          <span className="truncate">{task.description}</span>
        </div>
      )}

      {/* 页脚：优先级 + 截止日期 + 来源会话 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {/* 优先级徽章（none 不显示） */}
        {task.priority !== "none" && (
          <Badge
            variant="secondary"
            className={cn("h-4.5 gap-1 px-1.5 text-[10px]", priority.badge)}
          >
            <span className={cn("size-1.5 rounded-full", priority.dot)} />
            {priority.label}
          </Badge>
        )}

        {/* 截止日期 */}
        {task.due_date && (
          <span
            className={cn(
              "flex items-center gap-0.5 text-[10px]",
              overdue ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            <HugeiconsIcon
              icon={Calendar03Icon}
              strokeWidth={2}
              className="size-3"
            />
            {formatDate(task.due_date)}
          </span>
        )}

        {/* 来源会话徽章（点击跳转会话中枢） */}
        {task.source_session_id && (
          <button
            type="button"
            onClick={handleSourceClick}
            aria-label="跳转到来源会话"
            title={`来源会话：${task.source_session_id}`}
            className="ml-auto flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <HugeiconsIcon icon={Message01Icon} strokeWidth={2} className="size-3" />
            来源
          </button>
        )}
      </div>
    </div>
  );
}
