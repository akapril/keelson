// 日历轻量循环：把重复事件在可视区间内展开成 occurrence（只读展开，不做例外/单次编辑）。
// 覆盖 每天/每周/每月/每年；occurrence 携带母事件 id（编辑/删除作用于母事件=全部）。
import { addDays, addWeeks, addMonths, addYears, parseISO } from "date-fns";
import type { CalendarEvent } from "@/types/calendar";

/** 重复规则（空串 = 不重复）。 */
export type RepeatRule = "" | "daily" | "weekly" | "monthly" | "yearly";

export const REPEAT_OPTIONS: { value: RepeatRule; label: string }[] = [
  { value: "", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "yearly", label: "每年" },
];

const STEP: Record<Exclude<RepeatRule, "">, (d: Date, n: number) => Date> = {
  daily: addDays,
  weekly: addWeeks,
  monthly: addMonths,
  yearly: addYears,
};

// 单个事件在可视区最多展开的 occurrence 数（安全上限；配合 firstIndex 快进已足够）
const MAX_OCC = 400;

/** 快进：从母事件 start 起、第一个 >= rangeStart 的 occurrence 序号（避免从很久以前逐个迭代）。 */
export function firstIndexInRange(
  rule: Exclude<RepeatRule, "">,
  baseStart: Date,
  rangeStart: Date,
): number {
  const ms = rangeStart.getTime() - baseStart.getTime();
  if (ms <= 0) return 0;
  const DAY = 86_400_000;
  switch (rule) {
    case "daily":
      return Math.floor(ms / DAY);
    case "weekly":
      return Math.floor(ms / (7 * DAY));
    case "monthly":
      return Math.max(
        0,
        (rangeStart.getFullYear() - baseStart.getFullYear()) * 12 +
          (rangeStart.getMonth() - baseStart.getMonth()) -
          1,
      );
    case "yearly":
      return Math.max(0, rangeStart.getFullYear() - baseStart.getFullYear() - 1);
  }
}

/**
 * 把事件列表在 [rangeStart, rangeEnd] 内展开：
 * - 非重复事件原样返回；
 * - 重复事件生成落在区间内的 occurrence（虚拟事件，start/end 相对母事件平移整周期，保留母 id）。
 */
export function expandRecurringEvents(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const ev of events) {
    const rule = (ev.repeat || "") as RepeatRule;
    if (!rule || !(rule in STEP)) {
      out.push(ev);
      continue;
    }
    const step = STEP[rule as Exclude<RepeatRule, "">];
    const baseStart = parseISO(ev.start);
    if (Number.isNaN(baseStart.getTime())) {
      out.push(ev);
      continue;
    }
    const baseEnd = ev.end ? parseISO(ev.end) : null;
    const durMs =
      baseEnd && !Number.isNaN(baseEnd.getTime())
        ? baseEnd.getTime() - baseStart.getTime()
        : 0;

    const start = firstIndexInRange(rule as Exclude<RepeatRule, "">, baseStart, rangeStart);
    for (let n = 0; n < MAX_OCC; n++) {
      const occStart = step(baseStart, start + n);
      if (occStart.getTime() > rangeEnd.getTime()) break; // 超出右界 → 停
      const occEnd = durMs > 0 ? new Date(occStart.getTime() + durMs) : occStart;
      // occEnd >= rangeStart 才在可视区内（跨多日事件也能命中）
      if (occEnd.getTime() >= rangeStart.getTime()) {
        out.push({
          ...ev,
          start: occStart.toISOString(),
          end: durMs > 0 ? occEnd.toISOString() : ev.end,
        });
      }
    }
  }
  return out;
}
