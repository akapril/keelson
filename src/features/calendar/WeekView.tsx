// 周视图 —— 星期表头 + 全天行 + 小时时间轴（0:00–24:00 网格，默认滚动定位 6:00）。
// 组件仅接收父级已加载并展开好的数据；自身不访问 pb / store。
// DayColumn / layoutDayEvents 抽成可复用块，供 Stage 4 日视图（1 列）直接复用。
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

// 每小时行高（px）；时段事件的定位/高度都以此为基准
export const HOUR_PX = 48;
// 初始滚动定位到的可视起始小时（凌晨可继续往上滚）
const DEFAULT_SCROLL_HOUR = 6;

/**
 * 把 "HH:mm" 解析为「距 0:00 的分钟数」；非法输入返回 null。
 */
export function parseHM(hm: string | undefined): number | null {
  if (!hm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * 判断事件是否属于「时段事件」：非全天 且 有合法 start_time。
 * 其余（全天 / 无 start_time）都当全天处理，放到全天行。
 */
export function isTimedEvent(ev: CalendarEvent): boolean {
  return !ev.all_day && parseHM(ev.start_time) !== null;
}

// 单个时段事件在某天内的布局结果（含并排列信息）
export interface DayEventLayout {
  ev: CalendarEvent;
  /** 距 0:00 的起始分钟 */
  startMin: number;
  /** 距 0:00 的结束分钟（无 end_time 默认 +60 分钟） */
  endMin: number;
  /** 所在列序号（0 起） */
  colIndex: number;
  /** 该重叠簇的总列数（平分列宽用） */
  colCount: number;
}

/**
 * 计算某一天所有时段事件的重叠并排布局（纯函数，便于单测）。
 *
 * 算法（标准区间着色 + 重叠簇分列）：
 * 1. 过滤出时段事件，解析出 [startMin, endMin)（无 end_time → +60 分钟；至少 +30 分钟避免 0 高）。
 * 2. 按 startMin 升序（同起点按 endMin 升序）排序。
 * 3. 线性扫描分「重叠簇」：维护当前簇内各事件的 endMin，若新事件 start >= 簇内所有 end
 *    （即与整簇不再重叠），则结算上一簇、开新簇。
 * 4. 簇内用「列时间线」贪心分配列：为每个事件找第一个空闲列（其上一事件已结束），
 *    放不下则新增列。簇的 colCount = 该簇用到的最大列数，簇内全部事件共享该 colCount。
 */
export function layoutDayEvents(events: CalendarEvent[]): DayEventLayout[] {
  // 1. 解析时段事件为区间
  const spans = events
    .filter(isTimedEvent)
    .map((ev) => {
      const startMin = parseHM(ev.start_time) as number; // isTimedEvent 已保证非空
      const rawEnd = parseHM(ev.end_time);
      // 无结束或结束 <= 开始时，默认 60 分钟；并保证至少 30 分钟可视高度
      let endMin = rawEnd !== null && rawEnd > startMin ? rawEnd : startMin + 60;
      if (endMin - startMin < 30) endMin = startMin + 30;
      return { ev, startMin, endMin };
    })
    // 2. 排序：起点升序，同起点结束早的在前
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const result: DayEventLayout[] = [];
  // 3. 分重叠簇
  let cluster: typeof spans = [];
  let clusterMaxEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    // 4. 簇内贪心分列：columns[i] 记录第 i 列上一事件的 endMin
    const columns: number[] = [];
    const assigned: { span: (typeof cluster)[number]; col: number }[] = [];
    for (const span of cluster) {
      let placed = false;
      for (let i = 0; i < columns.length; i++) {
        if (span.startMin >= columns[i]) {
          columns[i] = span.endMin;
          assigned.push({ span, col: i });
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push(span.endMin);
        assigned.push({ span, col: columns.length - 1 });
      }
    }
    const colCount = columns.length; // 簇内共享列数 → 等宽平分
    for (const { span, col } of assigned) {
      result.push({
        ev: span.ev,
        startMin: span.startMin,
        endMin: span.endMin,
        colIndex: col,
        colCount,
      });
    }
    cluster = [];
    clusterMaxEnd = -1;
  };

  for (const span of spans) {
    if (cluster.length > 0 && span.startMin >= clusterMaxEnd) {
      // 与当前簇整体不再重叠 → 结算上一簇
      flush();
    }
    cluster.push(span);
    clusterMaxEnd = Math.max(clusterMaxEnd, span.endMin);
  }
  flush();

  return result;
}

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

// ── 单天时段列（可复用块）：只渲染 0:00–24:00 的时段事件绝对定位块 ──
interface DayColumnProps {
  day: Date;
  /** 该天的时段事件（父级已按天过滤好） */
  events: CalendarEvent[];
  /** 点击事件 → 编辑 */
  onEventClick: (ev: CalendarEvent) => void;
  /** 点击空白 → 以该天日期新建 */
  onEmptyClick: (day: Date) => void;
}

/**
 * 单天时段列：高度 = 24 * HOUR_PX，内部按 layoutDayEvents 绝对定位事件块。
 * Stage 4 日视图可直接复用（1 列即整宽）。
 */
export function DayColumn({ day, events, onEventClick, onEmptyClick }: DayColumnProps) {
  const layouts = useMemo(() => layoutDayEvents(events), [events]);

  return (
    <div
      className="relative border-r border-border"
      style={{ height: 24 * HOUR_PX }}
      // 点击列空白区域 → 以该天新建（事件块自身 stopPropagation）
      onClick={() => onEmptyClick(day)}
    >
      {/* 小时分隔线（每小时一条，仅视觉引导） */}
      {Array.from({ length: 24 }, (_, h) => (
        <div
          key={h}
          className="absolute inset-x-0 border-b border-border/50"
          style={{ top: h * HOUR_PX, height: HOUR_PX }}
        />
      ))}

      {/* 时段事件块：绝对定位 + 重叠并排平分列宽 */}
      {layouts.map((lo) => {
        const top = (lo.startMin / 60) * HOUR_PX;
        const height = Math.max(24, ((lo.endMin - lo.startMin) / 60) * HOUR_PX);
        // 并排：每列平分宽度，留 1px 间隙
        const widthPct = 100 / lo.colCount;
        const leftPct = widthPct * lo.colIndex;
        const color = lo.ev.color || "var(--color-primary)";
        return (
          <button
            key={`${lo.ev.id}-${lo.startMin}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation(); // 阻止冒泡到列空白新建
              onEventClick(lo.ev);
            }}
            title={lo.ev.title}
            className="absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-xs leading-tight transition-shadow hover:shadow-md"
            style={{
              top,
              height,
              left: `calc(${leftPct}% + 1px)`,
              width: `calc(${widthPct}% - 2px)`,
              // 浅底色（用户数据走内联样式）：色值 + 低透明背景，左侧色条强化归属
              background: `color-mix(in srgb, ${color} 18%, var(--color-background))`,
              borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
              borderLeft: `3px solid ${color}`,
            }}
          >
            <span className="block truncate font-medium text-foreground">
              {lo.ev.start_time} {lo.ev.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface WeekViewProps {
  /** 本周 7 天（父级用 eachDayOfInterval(startOfWeek..endOfWeek) 生成，保证与月网格同一周起始） */
  days: Date[];
  /** 已在本周区间展开后的事件（含重复 occurrence） */
  events: CalendarEvent[];
  /** 带 due_date 的看板任务 */
  tasks: BoardTask[];
  /** 点击事件 → 打开编辑弹窗（复用父级 openEdit） */
  onEventClick: (ev: CalendarEvent) => void;
  /** 点击任务 → 跳转看板（复用父级跳转逻辑） */
  onTaskClick: (task: BoardTask) => void;
  /** 点击某天空白 → 以该天日期新建（复用父级 openAdd） */
  onDayClick: (day: Date) => void;
}

export default function WeekView({
  days,
  events,
  tasks,
  onEventClick,
  onTaskClick,
  onDayClick,
}: WeekViewProps) {
  const { t } = useTranslation("calendar");
  // 时间轴滚动容器：挂载后定位到默认可视起始小时（6:00）
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_PX;
    }
  }, []);

  // 预分好每天的全天条目与时段事件，避免渲染时重复过滤
  const perDay = useMemo(() => {
    return days.map((day) => {
      const allDayEvents = events.filter(
        (ev) => eventCoversDay(ev, day) && !isTimedEvent(ev),
      );
      const timedEvents = events.filter(
        (ev) => isTimedEvent(ev) && isSameDay(startOfDay(parseISO(ev.start)), startOfDay(day)),
      );
      const dayTasks = tasks.filter((tk) => taskOnDay(tk, day));
      return { day, allDayEvents, timedEvents, dayTasks };
    });
  }, [days, events, tasks]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* ── 星期表头行：左侧留出时间刻度列宽（w-14）+ 7 天列 ── */}
      <div className="grid shrink-0 border-b border-border" style={gridCols}>
        <div className="border-r border-border" /> {/* 时间列占位 */}
        {days.map((day) => {
          const today = isToday(day);
          return (
            <div
              key={day.toISOString()}
              className="flex flex-col items-center gap-0.5 border-r border-border py-2"
            >
              <span className="text-xs text-muted-foreground">
                {format(day, "EEE")}
              </span>
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-sm",
                  today && "bg-primary font-medium text-primary-foreground",
                )}
              >
                {format(day, "d")}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── 全天行：左侧「全天」标签 + 7 天全天条目 ── */}
      <div
        className="grid shrink-0 border-b border-border"
        style={gridCols}
      >
        <div className="flex items-center justify-end border-r border-border px-1.5 py-1 text-xs text-muted-foreground">
          {t("agenda.allDay")}
        </div>
        {perDay.map(({ day, allDayEvents, dayTasks }) => (
          <div
            key={day.toISOString()}
            className="flex min-h-8 cursor-pointer flex-col gap-0.5 border-r border-border p-1 hover:bg-muted/30"
            onClick={() => onDayClick(day)}
          >
            {/* ①全天事件 ②当全天处理的无时刻事件 → 小胶囊 */}
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
        ))}
      </div>

      {/* ── 小时时间轴（可纵向滚动）：0:00–24:00 全渲染，初始滚动到 6:00 ── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid" style={gridCols}>
          {/* 左侧小时刻度列 */}
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

          {/* 7 天时段列（复用 DayColumn，Stage 4 日视图同一块） */}
          {perDay.map(({ day, timedEvents }) => (
            <DayColumn
              key={day.toISOString()}
              day={day}
              events={timedEvents}
              onEventClick={onEventClick}
              onEmptyClick={onDayClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// 网格列模板：固定时间列(3.5rem) + 7 等分天列。抽为常量供表头/全天行/时间轴共享，保证列对齐。
const gridCols: React.CSSProperties = {
  gridTemplateColumns: "3.5rem repeat(7, minmax(0, 1fr))",
};
