// TaskCard —— 看板单任务卡片（视觉移植自 workavera todo-card，绑定我们的 store/类型）。
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar03Icon,
  TextAlignLeftIcon,
  Message01Icon,
  CheckmarkCircle02Icon,
  CircleIcon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { stripMarkdown } from "@/lib/markdown-preview";
import { useBoardStore } from "@/store/board";
import type { BoardTask } from "@/types/board";
import { PRIORITY_META, PRIORITY_ORDER } from "./board-meta";

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
  /** 当前是否处于多选模式。 */
  selectMode?: boolean;
  /** 当前卡片是否被选中（多选模式下）。 */
  selected?: boolean;
  /** 切换本卡片勾选状态（多选模式下点击卡片触发）。 */
  onToggleSelect?: (taskId: string) => void;
  /** 进入多选模式（右键菜单"选择"项触发）。 */
  onEnterSelect?: (taskId: string) => void;
}

/**
 * 可拖拽任务卡片：标签 chip / 标题 / 描述指示 / 优先级徽章 / 截止日期 / 来源会话徽章。
 * inline style 仅用于用户数据颜色（label.color）与 dnd transform。
 * 多选模式：左上角勾选框 + 点击切换勾选（不打开编辑）；拖拽禁用。
 */
export function TaskCard({
  task,
  onEdit,
  selectMode = false,
  selected = false,
  onToggleSelect,
  onEnterSelect,
}: TaskCardProps) {
  const labels = useBoardStore((s) => s.labels);
  const states = useBoardStore((s) => s.states);
  const tasks = useBoardStore((s) => s.tasks);
  const updateTask = useBoardStore((s) => s.updateTask);
  const deleteTask = useBoardStore((s) => s.deleteTask);
  const moveTask = useBoardStore((s) => s.moveTask);
  const navigate = useNavigate();

  // 右键菜单：改优先级（同优先级不重复写）
  const setPriority = (p: BoardTask["priority"]) => {
    if (p === task.priority) return;
    void updateTask(task.id, { priority: p }).catch((e) =>
      toast.error(`修改优先级失败：${String(e)}`),
    );
  };
  // 右键菜单：移动到目标状态列（追加到末尾）
  const moveTo = (stateId: string) => {
    if (stateId === task.state) return;
    const toIndex = tasks.filter((t) => t.state === stateId).length;
    void moveTask(task.id, stateId, toIndex).catch((e) =>
      toast.error(`移动失败：${String(e)}`),
    );
  };
  // 右键菜单：删除
  const remove = () => {
    void deleteTask(task.id)
      .then(() => toast.success("已删除任务"))
      .catch((e) => toast.error(`删除失败：${String(e)}`));
  };
  // 右键菜单：跳转来源会话（不经卡片点击事件）
  const goSource = () => {
    if (!task.source_session_id) return;
    const params = new URLSearchParams({ session: task.source_session_id });
    if (task.source_provider) params.set("provider", task.source_provider);
    navigate(`/sessions?${params.toString()}`);
  };

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
    // 多选模式下禁用拖拽，避免多选点击与拖拽冲突
    disabled: selectMode,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  // 卡片点击：多选模式下切换勾选；普通模式下打开编辑
  function handleCardClick(e: React.MouseEvent) {
    if (selectMode) {
      e.stopPropagation();
      onToggleSelect?.(task.id);
    } else {
      onEdit?.(task);
    }
  }

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
    <ContextMenu>
      <ContextMenuTrigger asChild>
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleCardClick}
      className={cn(
        "group/card relative cursor-pointer rounded-xl border border-border/60 bg-card p-3 shadow-sm transition-all hover:border-border hover:shadow-md",
        isDragging && "opacity-50 shadow-lg ring-2 ring-primary/20",
        // 多选模式选中态：蓝色描边高亮
        selectMode && selected && "border-primary/60 ring-1 ring-primary/30 bg-primary/5",
        // 已归档：降饱和虚线框，与活跃任务区分
        task.archived && "border-dashed opacity-60",
      )}
    >
      {/* 已归档角标 */}
      {task.archived && (
        <span className="absolute right-2 top-2 z-10 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          已归档
        </span>
      )}
      {/* 多选模式：左上角勾选图标 */}
      {selectMode && (
        <div className="absolute left-2 top-2 z-10">
          <HugeiconsIcon
            icon={selected ? CheckmarkCircle02Icon : CircleIcon}
            strokeWidth={2}
            className={cn(
              "size-4 transition-colors",
              selected ? "text-primary" : "text-muted-foreground",
            )}
          />
        </div>
      )}

      {/* 标签 chips（颜色来自用户数据，inline style；多选模式缩进避开勾选框） */}
      {taskLabels.length > 0 && (
        <div className={cn("mb-2 flex flex-wrap gap-1", selectMode && "pl-6")}>
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

      {/* 标题（多选模式且无标签时缩进，避开勾选框） */}
      <p className={cn(
        "text-sm font-medium leading-snug text-foreground",
        selectMode && taskLabels.length === 0 && "pl-6",
      )}>
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
          {/* 预览：剥掉 markdown 语法噪声后单行截断（描述可能是 markdown 数据） */}
          <span className="truncate">{stripMarkdown(task.description)}</span>
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
      </ContextMenuTrigger>

      {/* 右键菜单：选择（进入多选）/ 编辑 / 优先级 / 移动 / 来源会话 / 删除 */}
      <ContextMenuContent>
        {/* 「选择」：进入多选模式并将本卡片设为已选 */}
        <ContextMenuItem onSelect={() => onEnterSelect?.(task.id)}>选择</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onEdit?.(task)}>编辑</ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger>优先级</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {PRIORITY_ORDER.map((p) => (
              <ContextMenuItem key={p} onSelect={() => setPriority(p)}>
                <span className={cn("size-1.5 rounded-full", PRIORITY_META[p].dot)} />
                {PRIORITY_META[p].label}
                {p === task.priority && (
                  <span className="ml-auto text-xs text-muted-foreground">当前</span>
                )}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>移动到</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {states.length === 0 ? (
              <ContextMenuLabel>无可用状态列</ContextMenuLabel>
            ) : (
              states.map((st) => (
                <ContextMenuItem
                  key={st.id}
                  disabled={st.id === task.state}
                  onSelect={() => moveTo(st.id)}
                >
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: st.color }} />
                  {st.name}
                  {st.id === task.state && (
                    <span className="ml-auto text-xs text-muted-foreground">当前</span>
                  )}
                </ContextMenuItem>
              ))
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {task.source_session_id && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={goSource}>
              跳转来源会话
            </ContextMenuItem>
          </>
        )}

        <ContextMenuSeparator />
        {/* 归档：完成任务软删除（保留溯源），默认从看板隐藏；可取消归档 */}
        <ContextMenuItem
          onSelect={() =>
            void updateTask(task.id, { archived: !task.archived }).catch((e) =>
              toast.error(`操作失败：${String(e)}`),
            )
          }
        >
          {task.archived ? "取消归档" : "归档"}
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={remove}>
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
