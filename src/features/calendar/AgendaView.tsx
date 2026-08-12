// 议程视图 —— 今天起未来 30 天（含今天）的事件 + 任务，按天分组的列表。
// 组件仅接收父级已加载好的数据（展开后的事件 + 任务），自身不发起数据访问。
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import {
  addDays,
  startOfDay,
  parseISO,
  isSameDay,
  isToday,
  isTomorrow,
  format,
  differenceInCalendarDays,
} from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import { KanbanIcon } from "@hugeicons/core-free-icons";
import type { CalendarEvent } from "@/types/calendar";
import type { BoardTask } from "@/types/board";
import { cn } from "@/lib/utils";

// 议程覆盖天数（含今天）：今天起未来 30 天
const AGENDA_DAYS = 30;

// 议程内的一条目：事件或任务，统一携带排序锚点
type AgendaItem =
  | { kind: "event"; ev: CalendarEvent; sortKey: string }
  | { kind: "task"; task: BoardTask; sortKey: string };

// 一天的分组
interface DayGroup {
  day: Date;
  items: AgendaItem[];
}

/** 安全解析 ISO 为 Date；失败返回 null。 */
function safeParse(iso: string): Date | null {
  if (!iso) return null;
  try {
    const d = parseISO(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * 计算排序键：全天 / 无时刻 → "00:00"（同日内排在带时刻的前面）；
 * 带时刻 → 该时刻字符串（"HH:mm" 可字典序比较）。
 */
function eventSortKey(ev: CalendarEvent): string {
  if (ev.all_day || !ev.start_time) return "00:00";
  return ev.start_time;
}

export interface AgendaViewProps {
  /** 已在可视区展开后的事件（含重复 occurrence） */
  events: CalendarEvent[];
  /** 带 due_date 的看板任务 */
  tasks: BoardTask[];
  /** 点击事件 → 打开编辑弹窗（复用父级 openEdit） */
  onEventClick: (ev: CalendarEvent) => void;
  /** 点击任务 → 跳转看板（复用父级跳转逻辑） */
  onTaskClick: (task: BoardTask) => void;
}

export default function AgendaView({
  events,
  tasks,
  onEventClick,
  onTaskClick,
}: AgendaViewProps) {
  const { t } = useTranslation("calendar");

  // 计算未来 30 天（含今天）的分组：逐日过滤覆盖该天的事件与任务
  const groups = useMemo<DayGroup[]>(() => {
    const today = startOfDay(new Date());
    const result: DayGroup[] = [];

    for (let i = 0; i < AGENDA_DAYS; i++) {
      const day = addDays(today, i);
      const items: AgendaItem[] = [];

      // 覆盖该天的事件：[start 当日, (end||start) 当日] 闭区间
      for (const ev of events) {
        const start = safeParse(ev.start);
        if (!start) continue;
        const end = safeParse(ev.end || ev.start) ?? start;
        const s = startOfDay(start).getTime();
        const e = startOfDay(end).getTime();
        const dTime = startOfDay(day).getTime();
        if (dTime >= s && dTime <= e) {
          items.push({ kind: "event", ev, sortKey: eventSortKey(ev) });
        }
      }

      // 落在该天的任务（任务无时刻，排序键固定 "00:00" 排在前面）
      for (const task of tasks) {
        if (!task.due_date) continue;
        const due = safeParse(task.due_date);
        if (due && isSameDay(startOfDay(due), day)) {
          items.push({ kind: "task", task, sortKey: "00:00" });
        }
      }

      if (items.length > 0) {
        // 同日内：按 sortKey 升序（全天/任务在前，带时刻的按时刻靠后）
        items.sort((a, b) => (a.sortKey > b.sortKey ? 1 : a.sortKey < b.sortKey ? -1 : 0));
        result.push({ day, items });
      }
    }
    return result;
  }, [events, tasks]);

  // 段头文案：今天 / 明天 / 本周内(含7天内)显示周几 / 更远显示 M月d日 周几
  const formatDayHeader = (day: Date): string => {
    if (isToday(day)) return t("agenda.today");
    if (isTomorrow(day)) return t("agenda.tomorrow");
    const diff = differenceInCalendarDays(day, startOfDay(new Date()));
    const isZh = i18n.language.startsWith("zh");
    // 本周内（未来 7 天内）：只显示周几
    if (diff < 7) {
      return format(day, "EEEE");
    }
    // 更远：中文 "M月d日 周几"，英文 "MMM d, EEE"
    return isZh
      ? format(day, "M") + "月" + format(day, "d") + "日 " + format(day, "EEEE")
      : format(day, "MMM d, EEE");
  };

  if (groups.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("agenda.empty")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 py-4">
        {groups.map((g) => (
          <section key={g.day.toISOString()} className="flex flex-col gap-1.5">
            {/* 段头：分组日期 */}
            <h2
              className={cn(
                "sticky top-0 z-10 bg-background/95 py-1 text-sm font-semibold backdrop-blur",
                isToday(g.day) ? "text-primary" : "text-foreground",
              )}
            >
              {formatDayHeader(g.day)}
            </h2>

            <div className="flex flex-col gap-1">
              {g.items.map((item) =>
                item.kind === "event" ? (
                  <button
                    key={`ev-${item.ev.id}-${item.ev.start}`}
                    type="button"
                    onClick={() => onEventClick(item.ev)}
                    className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-muted/50"
                  >
                    {/* 时刻列：带时刻显示 "HH:mm"，否则显示「全天」 */}
                    <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {!item.ev.all_day && item.ev.start_time
                        ? item.ev.start_time
                        : t("agenda.allDay")}
                    </span>
                    {/* 项目色点 */}
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: item.ev.color || "var(--color-primary)" }}
                    />
                    <span className="truncate text-sm text-foreground">
                      {item.ev.title}
                    </span>
                  </button>
                ) : (
                  <button
                    key={`tk-${item.task.id}`}
                    type="button"
                    onClick={() => onTaskClick(item.task)}
                    className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-muted/50"
                  >
                    {/* 任务无时刻，占位对齐 */}
                    <span className="w-14 shrink-0 text-xs text-muted-foreground">
                      {t("agenda.taskBadge")}
                    </span>
                    <HugeiconsIcon
                      icon={KanbanIcon}
                      strokeWidth={2}
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="truncate text-sm text-muted-foreground">
                      {item.task.title}
                    </span>
                  </button>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
