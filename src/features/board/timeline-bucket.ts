// 截止日归桶纯函数：把任务按 due_date 归入周/月桶，无 due 的入 unscheduled。
// 时间全用 ms 比较（PB 存 "YYYY-MM-DD HH:MM:SS" 空格格式，字典序不可靠；Date.parse 容错）。
// nowMs 由调用方传入（纯函数不读当前时间，可测）。
import type { BoardTask } from "@/types/board";

export type Granularity = "week" | "month";

export interface DueBucket {
  key: string;
  label: string;
  startMs: number;
  endMs: number;
  tasks: BoardTask[];
}

/** due 的 ms（无效/空 → null）。 */
function dueMs(t: BoardTask): number | null {
  if (!t.due_date) return null;
  const ms = Date.parse(t.due_date.replace(" ", "T"));
  return Number.isNaN(ms) ? null : ms;
}

/** 桶代表日：周=UTC 周一 0 点；月=UTC 月初 0 点。 */
export function bucketStartMs(ms: number, g: Granularity): number {
  const d = new Date(ms);
  if (g === "month") {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  // week：回退到周一（getUTCDay：0=周日..6=周六）
  const day = d.getUTCDay();
  const backToMon = (day + 6) % 7; // 周一=0
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return base - backToMon * 86400000;
}

function bucketEndMs(startMs: number, g: Granularity): number {
  const d = new Date(startMs);
  if (g === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return startMs + 7 * 86400000;
}

function bucketLabel(startMs: number, g: Granularity): string {
  const d = new Date(startMs);
  if (g === "month") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function bucketByDue(
  tasks: BoardTask[],
  granularity: Granularity,
  _nowMs: number,
): { buckets: DueBucket[]; unscheduled: BoardTask[] } {
  const unscheduled: BoardTask[] = [];
  const map = new Map<number, DueBucket>();

  for (const t of tasks) {
    const ms = dueMs(t);
    if (ms == null) {
      unscheduled.push(t);
      continue;
    }
    const start = bucketStartMs(ms, granularity);
    let bk = map.get(start);
    if (!bk) {
      bk = { key: String(start), label: bucketLabel(start, granularity), startMs: start, endMs: bucketEndMs(start, granularity), tasks: [] };
      map.set(start, bk);
    }
    bk.tasks.push(t);
  }

  // 桶按 startMs 升序；桶内按 due 升序再 rank
  const buckets = [...map.values()].sort((a, b) => a.startMs - b.startMs);
  for (const bk of buckets) {
    bk.tasks.sort((a, b) => {
      const da = dueMs(a) ?? 0;
      const db = dueMs(b) ?? 0;
      if (da !== db) return da - db;
      return (a.rank ?? 0) - (b.rank ?? 0);
    });
  }
  return { buckets, unscheduled };
}
