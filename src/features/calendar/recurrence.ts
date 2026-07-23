// 日历轻量循环：把重复事件在可视区间内展开成 occurrence（只读展开，不做例外/单次编辑）。
// 覆盖 每天/每周/每月/每年；occurrence 携带母事件 id（编辑/删除作用于母事件=全部）。
import { addDays, addWeeks, addMonths, addYears, parseISO } from "date-fns";
import type { CalendarEvent } from "@/types/calendar";

/** 重复单位。 */
export type RepeatUnit = "daily" | "weekly" | "monthly" | "yearly";

// 单位下拉选项（"" = 不重复）；周期步长 N 由单独的数字输入提供。
export const REPEAT_OPTIONS: { value: "" | RepeatUnit; label: string }[] = [
  { value: "", label: "不重复" },
  { value: "daily", label: "每 N 天" },
  { value: "weekly", label: "每 N 周" },
  { value: "monthly", label: "每 N 月" },
  { value: "yearly", label: "每 N 年" },
];

const STEP: Record<RepeatUnit, (d: Date, n: number) => Date> = {
  daily: addDays,
  weekly: addWeeks,
  monthly: addMonths,
  yearly: addYears,
};

export interface ParsedRepeat {
  unit: RepeatUnit;
  /** 步长 N（每 N 个单位；>=1） */
  interval: number;
}

/** 解析 repeat 串："daily" / "daily:2" → {unit, interval}；空/非法 → null。 */
export function parseRepeat(s: string | undefined): ParsedRepeat | null {
  if (!s) return null;
  const [unit, nStr] = s.split(":");
  if (!(unit in STEP)) return null;
  const interval = Math.max(1, Math.floor(Number(nStr) || 1));
  return { unit: unit as RepeatUnit, interval };
}

/** 组合 repeat 串：interval<=1 存 "daily"，否则 "daily:N"；unit 空 → 空串。 */
export function buildRepeat(unit: string, interval: number): string {
  if (!unit || !(unit in STEP)) return "";
  const n = Math.max(1, Math.floor(interval || 1));
  return n <= 1 ? unit : `${unit}:${n}`;
}

// 单个事件在可视区最多展开的 occurrence 数（安全上限；配合 firstIndex 快进已足够）
const MAX_OCC = 400;

/** 快进：从母事件 start 起、覆盖到 rangeStart 所需的「单位数」（避免从很久以前逐个迭代）。 */
export function firstIndexInRange(
  rule: RepeatUnit,
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
    const parsed = parseRepeat(ev.repeat);
    if (!parsed) {
      out.push(ev);
      continue;
    }
    const { unit, interval } = parsed;
    const step = STEP[unit];
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

    // occurrence k 落在 step(base, k*interval)。快进：k0 = 覆盖到 rangeStart 的单位数 / 步长。
    const offset = firstIndexInRange(unit, baseStart, rangeStart);
    const k0 = Math.floor(offset / interval);
    for (let n = 0; n < MAX_OCC; n++) {
      const k = k0 + n;
      const occStart = step(baseStart, k * interval);
      if (occStart.getTime() > rangeEnd.getTime()) break; // 超出右界 → 停
      const occEnd = durMs > 0 ? new Date(occStart.getTime() + durMs) : occStart;
      // occEnd >= rangeStart 才在可视区内（跨多日事件、以及 floor 导致的略早也在此过滤）
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
