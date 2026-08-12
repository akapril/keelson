// 周视图 —— 星期表头 + 全天行 + 小时时间轴（0:00–24:00 网格，默认滚动定位 6:00）。
// 组件仅接收父级已加载并展开好的数据；自身不访问 pb / store。
// DayColumn / layoutDayEvents 抽成可复用块，供 Stage 4 日视图（1 列）直接复用。
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  snapMinutes,
  minuteFromY,
  durationMin,
  minutesToHM,
  dayIndexFromX,
} from "./timeGrid";

// 点/拖区分阈值（px）：指针移动超过该距离才算拖拽，否则当点击。
const DRAG_THRESHOLD_PX = 4;
// 拖拽/点空白的吸附步长（分钟）
const SNAP_STEP_MIN = 15;

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
  /**
   * 点击空白 → 新建。startMin 为落点吸附后的起始分钟（距 0:00）。
   * 父级据此预填 start_time / end_time(+1h)。
   */
  onEmptyClick: (day: Date, startMin: number) => void;
  /**
   * 拖拽落定改期：ev=被拖事件，targetDay=落点目标日（日视图恒为本列 day，
   * 周视图由 resolveDay 跨列换算），newStartMin=吸附后的新起始分钟（距 0:00）。
   * 父级负责保留原时长并落库。未传则该列不支持拖拽（退化为纯点击）。
   */
  onEventReschedule?: (ev: CalendarEvent, targetDay: Date, newStartMin: number) => void;
  /**
   * 由指针 clientX 换算落点目标日（周视图跨 7 列用）。默认返回本列 day（日视图/单列）。
   * 抽成注入回调：几何统筹留给知道 7 列布局的 WeekView，DayColumn 只管垂直换算。
   */
  resolveDay?: (clientX: number) => Date;
}

// 拖拽进行中的临时状态（组件内，落定即清除）
interface DragState {
  ev: CalendarEvent;
  /** 原始起始分钟（用于回退/时长基准） */
  origStartMin: number;
  /** 该事件时长（分钟，拖拽全程保留） */
  durMin: number;
  /** 指针按下时的 clientX/clientY（判断是否越过阈值） */
  downX: number;
  downY: number;
  /** 当前是否已判定为拖拽（越过阈值） */
  moved: boolean;
  /** 预览：跟随指针的新起始分钟（已吸附） */
  previewStartMin: number;
}

/**
 * 单天时段列：高度 = 24 * HOUR_PX，内部按 layoutDayEvents 绝对定位事件块。
 * 日视图可直接复用（1 列即整宽）。
 * Stage 5：指针拖拽改期（吸附 15 分钟、保留时长、周视图跨列）+ 点空白按时刻新建。
 */
export function DayColumn({
  day,
  events,
  onEventClick,
  onEmptyClick,
  onEventReschedule,
  resolveDay,
}: DayColumnProps) {
  const layouts = useMemo(() => layoutDayEvents(events), [events]);
  // 列容器 ref：用于 getBoundingClientRect() 做 y→分钟 的几何换算
  const gridRef = useRef<HTMLDivElement>(null);
  // 拖拽临时状态（null=未拖拽）
  const [drag, setDrag] = useState<DragState | null>(null);

  // 取列容器顶端在视口中的 y（含滚动已抵消，getBoundingClientRect 实时反映）
  const gridTop = () => gridRef.current?.getBoundingClientRect().top ?? 0;

  // 由指针 y 换算 → 吸附后的起始分钟（距 0:00，夹到 0..1440）
  const startMinFromClientY = (clientY: number) =>
    snapMinutes(minuteFromY(clientY, gridTop()), SNAP_STEP_MIN);

  // 事件块指针按下：登记拖拽候选（尚未判定拖/点），并捕获指针。
  // 始终登记候选 → pointerup 能区分点/拖；是否真正进入拖拽由 onEventReschedule 是否存在决定。
  const handleEventPointerDown = (e: React.PointerEvent, ev: CalendarEvent, startMin: number) => {
    e.stopPropagation(); // 阻止冒泡到列空白（避免误触发新建）
    if (e.button !== 0) return; // 仅左键
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      ev,
      origStartMin: startMin,
      durMin: durationMin(ev.start_time, ev.end_time),
      downX: e.clientX,
      downY: e.clientY,
      moved: false,
      previewStartMin: startMin,
    });
  };

  // 事件块指针移动：越过阈值判为拖拽，实时更新预览起始分钟。
  // 无改期回调时不进入拖拽（保持候选态，pointerup 仍当点击）。
  const handleEventPointerMove = (e: React.PointerEvent) => {
    if (!drag || !onEventReschedule) return;
    const dx = e.clientX - drag.downX;
    const dy = e.clientY - drag.downY;
    const moved = drag.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
    if (!moved) return; // 未越阈值：保持候选态
    setDrag({ ...drag, moved: true, previewStartMin: startMinFromClientY(e.clientY) });
  };

  // 事件块指针抬起：区分「点击→编辑」与「拖拽→改期」
  const handleEventPointerUp = (e: React.PointerEvent) => {
    e.stopPropagation(); // 阻止冒泡到列空白 onPointerUp（避免误触发新建）
    if (!drag) return;
    const d = drag;
    setDrag(null); // 先清预览，避免闪烁
    if (!d.moved) {
      onEventClick(d.ev); // 未拖拽 → 当点击，打开编辑
      return;
    }
    // 拖拽落定：跨列目标日（周视图）由注入的 resolveDay 换算，默认本列 day
    const targetDay = resolveDay ? resolveDay(e.clientX) : day;
    const newStartMin = startMinFromClientY(e.clientY);
    onEventReschedule?.(d.ev, targetDay, newStartMin);
  };

  // 列空白指针抬起：仅当不在拖拽态时，按落点时刻新建
  const handleColumnPointerUp = (e: React.PointerEvent) => {
    if (drag) return; // 拖拽中松手不触发新建（由事件块 up 处理）
    onEmptyClick(day, startMinFromClientY(e.clientY));
  };

  return (
    <div
      ref={gridRef}
      className="relative border-r border-border"
      style={{ height: 24 * HOUR_PX }}
      // 点列空白（松手且非拖拽）→ 以落点时刻新建
      onPointerUp={handleColumnPointerUp}
    >
      {/* 小时分隔线（每小时一条，仅视觉引导） */}
      {Array.from({ length: 24 }, (_, h) => (
        <div
          key={h}
          className="pointer-events-none absolute inset-x-0 border-b border-border/50"
          style={{ top: h * HOUR_PX, height: HOUR_PX }}
        />
      ))}

      {/* 时段事件块：绝对定位 + 重叠并排平分列宽 */}
      {layouts.map((lo) => {
        // 拖拽预览：被拖块的 top 跟随指针（新起始分钟），其余块保持原位
        const isDragging = drag?.moved && drag.ev.id === lo.ev.id;
        const effStartMin = isDragging ? drag!.previewStartMin : lo.startMin;
        const effEndMin = isDragging ? drag!.previewStartMin + drag!.durMin : lo.endMin;
        const top = (effStartMin / 60) * HOUR_PX;
        const height = Math.max(24, ((effEndMin - effStartMin) / 60) * HOUR_PX);
        // 并排：每列平分宽度，留 1px 间隙
        const widthPct = 100 / lo.colCount;
        const leftPct = widthPct * lo.colIndex;
        const color = lo.ev.color || "var(--color-primary)";
        return (
          <button
            key={`${lo.ev.id}-${lo.startMin}`}
            type="button"
            // 指针事件驱动拖/点区分（替代原 onClick，避免拖拽误触发编辑）
            onPointerDown={(e) => handleEventPointerDown(e, lo.ev, lo.startMin)}
            onPointerMove={handleEventPointerMove}
            onPointerUp={handleEventPointerUp}
            title={lo.ev.title}
            className={cn(
              "absolute touch-none select-none overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-xs leading-tight transition-shadow hover:shadow-md",
              isDragging
                ? "z-20 cursor-grabbing opacity-90 shadow-lg"
                : "cursor-grab",
            )}
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
              {/* 拖拽中实时显示预览起始时刻，便于对齐 */}
              {isDragging ? minutesToHM(drag!.previewStartMin) : lo.ev.start_time} {lo.ev.title}
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
  /**
   * 点击某天空白 → 新建（复用父级 openAdd）。
   * startMin 可选：时间轴空白按落点时刻预填（全天行点击不带 → undefined）。
   */
  onDayClick: (day: Date, startMin?: number) => void;
  /**
   * 时段事件拖拽落定改期（复用父级落库）：targetDay=落点目标日（跨列），
   * newStartMin=吸附后新起始分钟。父级保留原时长并更新 start/end/start_time/end_time。
   */
  onEventReschedule?: (ev: CalendarEvent, targetDay: Date, newStartMin: number) => void;
}

export default function WeekView({
  days,
  events,
  tasks,
  onEventClick,
  onTaskClick,
  onDayClick,
  onEventReschedule,
}: WeekViewProps) {
  const { t } = useTranslation("calendar");
  // 时间轴滚动容器：挂载后定位到默认可视起始小时（6:00）
  const scrollRef = useRef<HTMLDivElement>(null);
  // 天列区容器（不含左侧刻度列）：用于跨列拖拽时按 x 换算目标列
  const daysGridRef = useRef<HTMLDivElement>(null);

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
      {/* 时间轴外层网格：刻度列 + 「7 天子网格」整块（子网格内部再 7 等分），列宽与表头对齐 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid" style={timelineGridCols}>
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

          {/* 7 天时段列（复用 DayColumn）：包一层 7 等分子网格，供跨列拖拽按 x 换算目标列 */}
          <div ref={daysGridRef} className="grid" style={daysGridCols}>
            {perDay.map(({ day, timedEvents }) => (
              <DayColumn
                key={day.toISOString()}
                day={day}
                events={timedEvents}
                onEventClick={onEventClick}
                onEmptyClick={onDayClick}
                onEventReschedule={onEventReschedule}
                // 跨列换算：按指针 x 落在天列区第几列，映射到该列的 day
                resolveDay={(clientX) => {
                  const rect = daysGridRef.current?.getBoundingClientRect();
                  if (!rect) return day;
                  const idx = dayIndexFromX(clientX, rect.left, rect.width, days.length);
                  return days[idx] ?? day;
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// 网格列模板：固定时间列(3.5rem) + 7 等分天列。表头/全天行直接铺 7 个子项时用。
const gridCols: React.CSSProperties = {
  gridTemplateColumns: "3.5rem repeat(7, minmax(0, 1fr))",
};

// 时间轴外层网格：刻度列(3.5rem) + 「7 天子网格」整块占满剩余 1fr（子网格内部再 7 等分）。
// 与 gridCols 的可视列宽一致（3.5rem + 剩余 7 等分），保证表头/全天行/时间轴对齐。
const timelineGridCols: React.CSSProperties = {
  gridTemplateColumns: "3.5rem minmax(0, 1fr)",
};

// 时间轴内层「7 天子网格」列模板：7 等分。
const daysGridCols: React.CSSProperties = {
  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
};
