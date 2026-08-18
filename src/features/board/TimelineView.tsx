// TimelineView —— 截止日时间线视图：按周/月桶横向排列任务卡，支持拖拽改截止日。
// 拖拽语义：把任务拖到某桶 → updateTask({ due_date: 桶 startMs 对应的 "YYYY-MM-DD" })；
//           拖到「未排期」区 → updateTask({ due_date: "" })。
import { useState, useMemo, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useBoardStore } from "@/store/board";
import { useBoardViewStore } from "@/store/board-view";
import { taskMatchesFilter } from "./task-filter";
import { bucketByDue } from "./timeline-bucket";
import type { Granularity, DueBucket } from "./timeline-bucket";
import type { BoardTask } from "@/types/board";
import { PRIORITY_META } from "./board-meta";

// ── UTC ms → "YYYY-MM-DD" 辅助（与 bucketStartMs 使用同一套 UTC getter）──
function fmtUtcDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── 拖拽 droppable ID 常量 ──────────────────────────────────────────────────
// 桶 droppable：`bucket:<startMs>`；未排期：`unscheduled`
const UNSCHEDULED_ID = "unscheduled";
function bucketDropId(startMs: number): string {
  return `bucket:${startMs}`;
}
function parseBucketDropId(id: string): number | null {
  if (!id.startsWith("bucket:")) return null;
  const n = Number(id.slice("bucket:".length));
  return Number.isNaN(n) ? null : n;
}

// ── 单个任务行（简化卡片，适合横向窄桶） ─────────────────────────────────────
interface TaskRowProps {
  task: BoardTask;
  isDragging?: boolean;
}

function TaskRow({ task, isDragging }: TaskRowProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: task.id,
  });

  // 拖动时应用 translate 位移（CSS 变量方式）
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const priorityDot = task.priority ? PRIORITY_META[task.priority]?.dot : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "flex cursor-grab items-start gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-sm shadow-sm",
        "active:cursor-grabbing select-none",
        isDragging && "opacity-40",
      )}
    >
      {/* 优先级色点 */}
      {priorityDot && (
        <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", priorityDot)} />
      )}
      <span className="line-clamp-2 leading-snug text-foreground">{task.title}</span>
    </div>
  );
}

// ── 幽灵卡（DragOverlay 跟随光标） ──────────────────────────────────────────
function GhostRow({ task }: { task: BoardTask }) {
  const priorityDot = task.priority ? PRIORITY_META[task.priority]?.dot : undefined;
  return (
    <div className="flex w-48 rotate-2 cursor-grabbing items-start gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-sm shadow-lg opacity-90">
      {priorityDot && (
        <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", priorityDot)} />
      )}
      <span className="line-clamp-2 leading-snug text-foreground">{task.title}</span>
    </div>
  );
}

// ── 桶列（droppable 容器） ────────────────────────────────────────────────────
interface BucketColumnProps {
  bucket: DueBucket;
  activeId: string | null;
}

function BucketColumn({ bucket, activeId }: BucketColumnProps) {
  const { t } = useTranslation("board");
  const dropId = bucketDropId(bucket.startMs);
  const { setNodeRef, isOver } = useDroppable({ id: dropId });

  return (
    <div className="flex w-52 shrink-0 flex-col gap-2">
      {/* 桶标题 */}
      <div className="flex items-center gap-1.5 pb-1">
        <span className="text-xs font-semibold text-muted-foreground">{bucket.label}</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {bucket.tasks.length}
        </span>
      </div>
      {/* 可投放区域 */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-1.5 rounded-lg border border-dashed p-1.5 transition-colors",
          isOver ? "border-primary/60 bg-primary/5" : "border-border bg-muted/20",
        )}
      >
        {bucket.tasks.length === 0 && !isOver ? (
          <p className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            {t("timeline.empty")}
          </p>
        ) : (
          bucket.tasks.map((task) => (
            <TaskRow key={task.id} task={task} isDragging={activeId === task.id} />
          ))
        )}
      </div>
    </div>
  );
}

// ── 未排期区（droppable 容器） ─────────────────────────────────────────────────
interface UnscheduledSectionProps {
  tasks: BoardTask[];
  activeId: string | null;
}

function UnscheduledSection({ tasks, activeId }: UnscheduledSectionProps) {
  const { t } = useTranslation("board");
  const { setNodeRef, isOver } = useDroppable({ id: UNSCHEDULED_ID });

  return (
    <div className="flex shrink-0 flex-col gap-2">
      {/* 标题行 */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("timeline.unscheduled")}
        </span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {tasks.length}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
      {/* 可投放区域（横向滚动行） */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-14 flex-wrap gap-1.5 rounded-lg border border-dashed p-1.5 transition-colors",
          isOver ? "border-primary/60 bg-primary/5" : "border-border bg-muted/10",
        )}
      >
        {tasks.length === 0 && !isOver && (
          <p className="flex items-center text-xs text-muted-foreground">
            {t("timeline.empty")}
          </p>
        )}
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} isDragging={activeId === task.id} />
        ))}
      </div>
    </div>
  );
}

// ── 主视图 ──────────────────────────────────────────────────────────────────
export function TimelineView() {
  const { t } = useTranslation("board");
  const tasks = useBoardStore((s) => s.tasks);
  const updateTask = useBoardStore((s) => s.updateTask);
  const filter = useBoardViewStore((s) => s.filter);

  // 粒度：周 / 月（本地状态，不持久化）
  const [granularity, setGranularity] = useState<Granularity>("week");

  // 可见任务 = 全量任务 × 当前筛选条件
  const visible = useMemo(
    () => tasks.filter((task) => taskMatchesFilter(task, filter)),
    [tasks, filter],
  );

  // 按粒度分桶（Date.now() 在组件内取合法；TimelineView 非纯函数）
  const { buckets, unscheduled } = useMemo(
    () => bucketByDue(visible, granularity, Date.now()),
    [visible, granularity],
  );

  // 拖拽中的任务 id（用于 DragOverlay + 原位半透明）
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeTask = useMemo(
    () => (activeId ? tasks.find((t) => t.id === activeId) ?? null : null),
    [activeId, tasks],
  );

  // PointerSensor，6px 激活距离防误触
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = e;
      if (!over) return;
      const taskId = String(active.id);
      const overId = String(over.id);

      if (overId === UNSCHEDULED_ID) {
        // 投入「未排期」→ 清空截止日
        void updateTask(taskId, { due_date: "" }).catch((err: unknown) =>
          toast.error(t("timeline.dropError", { msg: String(err) })),
        );
        return;
      }

      const startMs = parseBucketDropId(overId);
      if (startMs == null) return;
      // 投入某桶 → 设截止日为该桶 UTC 起始日
      const dueDate = fmtUtcDate(startMs);
      void updateTask(taskId, { due_date: dueDate }).catch((err: unknown) =>
        toast.error(t("timeline.dropError", { msg: String(err) })),
      );
    },
    [updateTask, t],
  );

  const handleDragCancel = useCallback(() => setActiveId(null), []);

  // 全局空态（visible 为空）
  if (visible.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("timeline.empty")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 工具条：粒度切换 */}
      <div className="flex shrink-0 items-center gap-1">
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {(["week", "month"] as Granularity[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={cn(
                "rounded-md px-2.5 py-0.5 text-xs transition-colors",
                granularity === g
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(g === "week" ? "timeline.week" : "timeline.month")}
            </button>
          ))}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* 未排期区（顶部，固定宽度行） */}
        <UnscheduledSection tasks={unscheduled} activeId={activeId} />

        {/* 桶列（横向滚动） */}
        {buckets.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            {t("timeline.empty")}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-4">
            {buckets.map((bucket) => (
              <BucketColumn key={bucket.key} bucket={bucket} activeId={activeId} />
            ))}
          </div>
        )}

        {/* DragOverlay：跟随光标的幽灵卡 */}
        <DragOverlay>
          {activeTask ? <GhostRow task={activeTask} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
