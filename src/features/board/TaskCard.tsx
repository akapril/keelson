// TaskCard —— 看板单任务卡片（视觉移植自 workavera todo-card，绑定我们的 store/类型）。
import { memo, useMemo, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
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
import type { BoardTask, BoardLabel, BoardState } from "@/types/board";
import { PRIORITY_META, PRIORITY_ORDER } from "./board-meta";
import { isCliSynced, toggleInject, getInjectSet } from "./cli-task-source";

// ── 日期格式化 ────────────────────────────────────────────────
function formatDate(dateStr: string, locale: string): string {
  return new Date(dateStr).toLocaleDateString(locale, {
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
  /** 全部标签（由父列 StatusColumn 订阅一次后传入，避免每卡各订阅整个 labels 数组）。 */
  labels: BoardLabel[];
  /** 全部状态列（同上，供右键"移动到"子菜单；父列订阅一次传入）。 */
  states: BoardState[];
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
function TaskCardInner({
  task,
  labels,
  states,
  onEdit,
  selectMode = false,
  selected = false,
  onToggleSelect,
  onEnterSelect,
}: TaskCardProps) {
  // labels/states 改由父列传入（不再每卡各订阅整个数组）；
  // 仅保留下面几个稳定函数 selector（返回同一引用，求值代价可忽略）。
  const updateTask = useBoardStore((s) => s.updateTask);
  const deleteTask = useBoardStore((s) => s.deleteTask);
  const moveTask = useBoardStore((s) => s.moveTask);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("board");

  // 右键菜单：改优先级（同优先级不重复写）
  const setPriority = (p: BoardTask["priority"]) => {
    if (p === task.priority) return;
    void updateTask(task.id, { priority: p }).catch((e) =>
      toast.error(t("task.toast.priorityError", { msg: String(e) })),
    );
  };
  // 右键菜单：移动到目标状态列（追加到末尾）
  const moveTo = (stateId: string) => {
    if (stateId === task.state) return;
    // 点击时按需读一次 tasks（getState 非订阅），避免每张卡订阅整个 tasks 数组
    // 导致任一任务变动全体卡片重渲。
    const toIndex = useBoardStore
      .getState()
      .tasks.filter((tk) => tk.state === stateId).length;
    void moveTask(task.id, stateId, toIndex).catch((e) =>
      toast.error(t("task.toast.moveError", { msg: String(e) })),
    );
  };
  // 右键菜单：删除
  const remove = () => {
    void deleteTask(task.id)
      .then(() => toast.success(t("task.toast.deleteSuccess")))
      .catch((e) => toast.error(t("task.toast.deleteError", { msg: String(e) })));
  };
  // 右键菜单：跳转来源会话（不经卡片点击事件）
  const goSource = () => {
    if (!task.source_session_id) return;
    const params = new URLSearchParams({ session: task.source_session_id });
    if (task.source_provider) params.set("provider", task.source_provider);
    navigate(`/sessions?${params.toString()}`);
  };

  // 来源区分：CLI 同步来的任务不可注入 CLI（避免循环）；自建任务可加入「注入集」。
  const cliSynced = isCliSynced(task);
  const [inInjectSet, setInInjectSet] = useState(() =>
    getInjectSet(task.project).has(task.id),
  );
  const toggleInjectSet = () => {
    setInInjectSet(toggleInject(task.project, task.id));
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

  const taskLabels = useMemo(
    () => labels.filter((l) => task.labels?.includes(l.id)),
    [labels, task.labels],
  );
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
          {t("task.archived")}
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
            {t(`meta.priority.${task.priority}`)}
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
            {formatDate(task.due_date, i18n.language)}
          </span>
        )}

        {/* 来源会话徽章（点击跳转会话中枢）。CLI 同步来的额外标「↻会话」以区分自建任务。 */}
        {task.source_session_id && (
          <button
            type="button"
            onClick={handleSourceClick}
            aria-label={t("task.sourceSessionAriaLabel")}
            title={
              cliSynced
                ? t("task.sourceSessionCliTitle", { id: task.source_session_id })
                : t("task.sourceSessionTitle", { id: task.source_session_id })
            }
            className={cn(
              "ml-auto flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
              cliSynced
                ? "bg-primary/10 text-primary hover:bg-primary/20"
                : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary",
            )}
          >
            <HugeiconsIcon icon={Message01Icon} strokeWidth={2} className="size-3" />
            {cliSynced ? t("task.sourceSessionCli") : t("task.sourceSession")}
          </button>
        )}
      </div>
    </div>
      </ContextMenuTrigger>

      {/* 右键菜单：选择（进入多选）/ 编辑 / 优先级 / 移动 / 来源会话 / 删除 */}
      <ContextMenuContent>
        {/* 「选择」：进入多选模式并将本卡片设为已选 */}
        <ContextMenuItem onSelect={() => onEnterSelect?.(task.id)}>{t("task.ctxMenu.select")}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onEdit?.(task)}>{t("task.ctxMenu.edit")}</ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("task.ctxMenu.priority")}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {PRIORITY_ORDER.map((p) => (
              <ContextMenuItem key={p} onSelect={() => setPriority(p)}>
                <span className={cn("size-1.5 rounded-full", PRIORITY_META[p].dot)} />
                {t(`meta.priority.${p}`)}
                {p === task.priority && (
                  <span className="ml-auto text-xs text-muted-foreground">{t("task.ctxMenu.current")}</span>
                )}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("task.ctxMenu.moveTo")}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {states.length === 0 ? (
              <ContextMenuLabel>{t("task.ctxMenu.noStates")}</ContextMenuLabel>
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
                    <span className="ml-auto text-xs text-muted-foreground">{t("task.ctxMenu.current")}</span>
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
              {t("task.ctxMenu.gotoSource")}
            </ContextMenuItem>
          </>
        )}

        {/* 注入 CLI：仅自建任务可加入注入集（CLI 同步来的排除，避免注回自己） */}
        {!cliSynced && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={toggleInjectSet}>
              {inInjectSet ? t("task.ctxMenu.removeFromInjectSet") : t("task.ctxMenu.addToInjectSet")}
            </ContextMenuItem>
          </>
        )}

        <ContextMenuSeparator />
        {/* 归档：完成任务软删除（保留溯源），默认从看板隐藏；可取消归档 */}
        <ContextMenuItem
          onSelect={() =>
            void updateTask(task.id, { archived: !task.archived }).catch((e) =>
              toast.error(t("task.toast.archiveError", { msg: String(e) })),
            )
          }
        >
          {task.archived ? t("task.ctxMenu.unarchive") : t("task.ctxMenu.archive")}
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={remove}>
          {t("common:action.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// memo：仅当自身 props（task/选中态/回调）变化才重渲。
// 关键前提——已去掉组件内对整个 tasks 数组的订阅，否则 memo 会被 store 订阅击穿。
// 父层需传稳定回调（KanbanBoard 已 useCallback），否则 memo 失效。
export const TaskCard = memo(TaskCardInner);
