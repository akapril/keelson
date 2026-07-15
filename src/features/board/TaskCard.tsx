// TaskCard —— 看板单任务卡片，支持 dnd-kit 拖拽排序。
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "react-router-dom";
import { useBoardStore } from "../../store/board";
import type { BoardTask } from "../../types/board";

// ── 优先级元数据（语义颜色类） ──────────────────────────────────
const PRIORITY_DOT: Record<string, string> = {
  none: "bg-muted-foreground",
  low: "bg-sky-400",
  medium: "bg-yellow-400",
  high: "bg-orange-400",
  urgent: "bg-destructive",
};

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

// ── 组件属性 ───────────────────────────────────────────────────
interface TaskCardProps {
  task: BoardTask;
  /** 点击卡片进入编辑（拖拽激活距离 6px，纯点击不会触发拖拽）。 */
  onEdit?: (task: BoardTask) => void;
}

/**
 * 可拖拽任务卡片：title / 优先级点 / 标签 chip / 截止日期 / 来源会话徽章。
 * inline style 仅用于用户数据颜色（label.color）和 dnd transform。
 */
export function TaskCard({ task, onEdit }: TaskCardProps) {
  const labels = useBoardStore((s) => s.labels);
  const navigate = useNavigate();

  // 点击"来源会话"徽章：跳转到会话中枢，并通过 query 携带会话 id 作为
  // 最佳努力的定位信号（会话页选中状态目前为组件局部 state，无 store 选中位）。
  function handleSourceClick(e: React.MouseEvent) {
    // 阻止冒泡，避免触发卡片编辑（onEdit）与拖拽
    e.stopPropagation();
    if (!task.source_session_id) return;
    const params = new URLSearchParams({ session: task.source_session_id });
    if (task.source_provider) params.set("provider", task.source_provider);
    navigate(`/sessions?${params.toString()}`);
  }

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: {
      type: "task",
      stateId: task.state,
    },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  // 解析当前任务的标签对象
  const taskLabels = labels.filter((l) => task.labels?.includes(l.id));
  const dotClass = PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.none;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onEdit?.(task)}
      className={[
        "cursor-grab rounded-lg border border-border/60 bg-card p-3 shadow-sm",
        "select-none transition-all hover:border-border hover:shadow-md",
        isDragging ? "opacity-50 ring-2 ring-primary/20" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* 优先级点 + 标题 */}
      <div className="flex items-start gap-2">
        <span
          className={`mt-1.5 size-2 shrink-0 rounded-full ${dotClass}`}
          title={task.priority}
        />
        <p className="flex-1 text-sm font-medium leading-snug text-foreground">
          {task.title}
        </p>
      </div>

      {/* 标签 chips（颜色来自用户数据，使用 inline style） */}
      {taskLabels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {taskLabels.map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white"
              style={{ background: label.color }}
            >
              {label.name}
            </span>
          ))}
        </div>
      )}

      {/* 页脚：截止日期 + 来源会话徽章 */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* 截止日期 */}
        {task.due_date && (
          <span
            className={[
              "text-[10px]",
              isOverdue(task.due_date)
                ? "font-medium text-destructive"
                : "text-muted-foreground",
            ].join(" ")}
          >
            {formatDate(task.due_date)}
          </span>
        )}

        {/* 来源会话徽章：点击跳转到会话中枢并定位来源会话 */}
        {task.source_session_id && (
          <button
            type="button"
            onClick={handleSourceClick}
            aria-label="跳转到来源会话"
            title={`来源会话：${task.source_session_id}`}
            className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring"
          >
            来源会话
          </button>
        )}
      </div>
    </div>
  );
}
