// 回顾统计（纯函数，可测）—— 把 report 采集层的 ReportMaterial 汇成：
//   - 逐「本地日」计数（热力图数据）
//   - 按类型总计（提交/任务/会话）
//   - 按项目聚合（占比条）
// 复用 collectMaterial 的一次采集结果，前端内存计算，零 IPC。
import type { ReportMaterial } from "./report-collect";
import type { DateRange } from "./report-range";

const pad = (n: number) => String(n).padStart(2, "0");

/** 某 Date 的本地日 key（yyyy-MM-dd）。务必用本地日，勿用 iso.slice(0,10)（那是 UTC 日）。 */
function keyOfDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** ISO 时间戳 → 本地日 key。非法返回空串。 */
function localDayKey(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : keyOfDate(new Date(t));
}

/** 单日各类活动计数。 */
export interface DayBucket {
  commits: number;
  tasks: number;
  sessions: number;
  total: number;
}

/**
 * 逐日分桶：先按 range 预置每一天为 0（热力图要画空格），再按各 item 的时间戳累加到本地日。
 * range 外的 item（边界舍入等）跳过，保证网格恰好是 range 天数。
 */
export function buildDailyBuckets(
  m: ReportMaterial,
  range: DateRange,
): Map<string, DayBucket> {
  const map = new Map<string, DayBucket>();
  const cur = new Date(range.sinceMs);
  cur.setHours(0, 0, 0, 0);
  while (cur.getTime() <= range.untilMs) {
    map.set(keyOfDate(cur), { commits: 0, tasks: 0, sessions: 0, total: 0 });
    cur.setDate(cur.getDate() + 1);
  }
  const bump = (iso: string, field: "commits" | "tasks" | "sessions") => {
    const b = map.get(localDayKey(iso));
    if (!b) return;
    b[field] += 1;
    b.total += 1;
  };
  for (const g of m.commitGroups) for (const c of g.commits) bump(c.committed_at, "commits");
  for (const g of m.taskGroups) for (const t of g.tasks) bump(t.updated, "tasks");
  for (const g of m.sessionGroups) for (const s of g.sessions) bump(s.updated_at, "sessions");
  return map;
}

/** 按类型总计。 */
export function aggregateByType(m: ReportMaterial): {
  commits: number;
  tasks: number;
  sessions: number;
} {
  const sum = (arr: { length: number }[]) => arr.reduce((n, x) => n + x.length, 0);
  return {
    commits: sum(m.commitGroups.map((g) => g.commits)),
    tasks: sum(m.taskGroups.map((g) => g.tasks)),
    sessions: sum(m.sessionGroups.map((g) => g.sessions)),
  };
}

/** 按项目聚合（label 归并），按 total 降序。 */
export interface ProjectAgg {
  label: string;
  commits: number;
  tasks: number;
  sessions: number;
  total: number;
}
export function aggregateByProject(m: ReportMaterial): ProjectAgg[] {
  const byLabel = new Map<string, ProjectAgg>();
  const get = (label: string): ProjectAgg => {
    let a = byLabel.get(label);
    if (!a) {
      a = { label, commits: 0, tasks: 0, sessions: 0, total: 0 };
      byLabel.set(label, a);
    }
    return a;
  };
  for (const g of m.commitGroups) {
    const a = get(g.label);
    a.commits += g.commits.length;
    a.total += g.commits.length;
  }
  for (const g of m.taskGroups) {
    const a = get(g.label);
    a.tasks += g.tasks.length;
    a.total += g.tasks.length;
  }
  for (const g of m.sessionGroups) {
    const a = get(g.label);
    a.sessions += g.sessions.length;
    a.total += g.sessions.length;
  }
  return [...byLabel.values()].sort((a, b) => b.total - a.total);
}
