// 日视图 —— 单日：顶部「周几 + 日期」+ 全天行 + 小时时间轴（0:00–24:00 网格，默认滚动定位 6:00）。
// 结构与周视图一致，只是 1 列。时段列复用 WeekView 的 DayColumn，避免重写重叠布局逻辑。
// 组件仅接收父级已加载并展开好的数据；自身不访问 pb / store。
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  format,
  isToday,
  isSameDay,
  parseISO,
  startOfDay,
} from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import { KanbanIcon } from "@hugeicons/core-free-icons";
import type { CalendarEvent } from "@/types/calendar";
import type { BoardTask } from "@/types/board";
import { cn } from "@/lib/utils";
import { DayColumn, HOUR_PX, isTimedEvent } from "./WeekView";

// 初始滚动定位到的可视起始小时（凌晨可继续往上滚），与周视图保持一致
const DEFAULT_SCROLL_HOUR = 6;

/** 事件是否覆盖某天（用于全天行；闭区间 [start, end||start]）。解析失败跳过。 */
function eventCoversDay(ev: CalendarEvent, day: Date): boolean {
  try {
    const start = startOfDay(parseISO(ev.start));
    const end = startOfDay(parseISO(ev.end || ev.start));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
    const d = startOfDay(day).getTime();
    return d >= start.getTime() && d <= end.getTime();
  } catch {
    return false;
  }
}

/** 任务是否落在某天（安全解析）。 */
function taskOnDay(task: BoardTask, day: Date): boolean {
  if (!task.due_date) return false;
  try {
    return isSameDay(startOfDay(parseISO(task.due_date)), startOfDay(day));
  } catch {
    return false;
  }
}

export interface DayViewProps {
  /** 当前浏览的单日（父级游标 viewDate 当天） */
  day: Date;
  /** 已在「该天」区间展开后的事件（含重复 occurrence） */
  events: CalendarEvent[];
  /** 带 due_date 的看板任务（内部按 isSameDay 过滤到该天） */
  tasks: BoardTask[];
  /** 点击事件 → 打开编辑弹窗（复用父级 openEdit） */
  onEventClick: (ev: CalendarEvent) => void;
  /** 点击任务 → 跳转看板（复用父级跳转逻辑） */
  onTaskClick: (task: BoardTask) => void;
  /** 点击空白 → 以该天日期新建（复用父级 openAdd） */
  onDayClick: (day: Date) => void;
}

export default function DayView({
  day,
  events,
  tasks,
  onEventClick,
  onTaskClick,
  onDayClick,
}: DayViewProps) {
  const { t } = useTranslation("calendar");
  // 时间轴滚动容器：挂载后定位到默认可视起始小时（6:00），与周视图一致
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_PX;
    }
  }, []);

  // 预分该天的全天条目 / 时段事件 / 任务，避免渲染时重复过滤
  const { allDayEvents, timedEvents, dayTasks } = useMemo(() => {
    const allDay = events.filter(
      (ev) => eventCoversDay(ev, day) && !isTimedEvent(ev),
    );
    const timed = events.filter(
      (ev) => isTimedEvent(ev) && isSameDay(startOfDay(parseISO(ev.start)), startOfDay(day)),
    );
    const dueOnDay = tasks.filter((tk) => taskOnDay(tk, day));
    return { allDayEvents: allDay, timedEvents: timed, dayTasks: dueOnDay };
  }, [events, tasks, day]);

  const today = isToday(day);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* ── 表头行：左侧留出时间刻度列宽 + 单日「周几 + 日期」 ── */}
      <div className="grid shrink-0 border-b border-border" style={gridCols}>
        <div className="border-r border-border" /> {/* 时间列占位 */}
        <div className="flex flex-col items-center gap-0.5 border-r border-border py-2">
          <span className="text-xs text-muted-foreground">{format(day, "EEE")}</span>
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-full text-sm",
              today && "bg-primary font-medium text-primary-foreground",
            )}
          >
            {format(day, "d")}
          </span>
        </div>
      </div>

      {/* ── 全天行：左侧「全天」标签 + 单日全天条目 / 任务 due ── */}
      <div className="grid shrink-0 border-b border-border" style={gridCols}>
        <div className="flex items-center justify-end border-r border-border px-1.5 py-1 text-xs text-muted-foreground">
          {t("agenda.allDay")}
        </div>
        <div
          className="flex min-h-8 cursor-pointer flex-col gap-0.5 border-r border-border p-1 hover:bg-muted/30"
          onClick={() => onDayClick(day)}
        >
          {/* ①全天事件 ②当全天处理的无时刻事件 → 小胶囊（点击编辑） */}
          {allDayEvents.map((ev) => (
            <button
              key={ev.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEventClick(ev);
              }}
              title={ev.title}
              className="flex items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: ev.color || "var(--color-primary)" }}
              />
              <span className="truncate text-foreground">{ev.title}</span>
            </button>
          ))}
          {/* ③任务 due_date → 小胶囊（点击跳看板） */}
          {dayTasks.map((tk) => (
            <button
              key={tk.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTaskClick(tk);
              }}
              title={t("event.taskTooltip", { title: tk.title })}
              className="flex items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
            >
              <HugeiconsIcon
                icon={KanbanIcon}
                strokeWidth={2}
                className="size-3 shrink-0 text-muted-foreground"
              />
              <span className="truncate text-muted-foreground">{tk.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 小时时间轴（可纵向滚动）：0:00–24:00 全渲染，初始滚动到 6:00 ── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid" style={gridCols}>
          {/* 左侧小时刻度列（与周视图刻度列一致） */}
          <div className="relative border-r border-border" style={{ height: 24 * HOUR_PX }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: h * HOUR_PX }}
              >
                {/* 0:00 顶端不显示，避免贴边被裁 */}
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          {/* 单日时段列（复用 WeekView 的 DayColumn，1 列即整宽） */}
          <DayColumn
            day={day}
            events={timedEvents}
            onEventClick={onEventClick}
            onEmptyClick={onDayClick}
          />
        </div>
      </div>
    </div>
  );
}

// 网格列模板：固定时间列(3.5rem) + 单日列。与周视图刻度列宽一致，保证表头/全天行/时间轴对齐。
const gridCols: React.CSSProperties = {
  gridTemplateColumns: "3.5rem minmax(0, 1fr)",
};
