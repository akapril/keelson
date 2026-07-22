// 工作报告的时间范围计算（纯函数，可测）。
// 边界一律按本地时区计算；对外同时给出：
//   - sinceISO/untilISO：喂 gitLog 的 --since/--until（ISO 串）
//   - sinceMs/untilMs：做窗口过滤的毫秒值——避免 PB 的
//     "YYYY-MM-DD HH:MM:SS.sssZ"（空格分隔）与 toISOString 的 "T" 分隔
//     字典序不可比，故过滤统一用 Date.parse 后比毫秒。

export type RangePreset = "this-week" | "last-week" | "last-7" | "last-30" | "custom";

export interface DateRange {
  /** gitLog --since（含起点），本地边界转 ISO */
  sinceISO: string;
  /** gitLog --until（含当天末），本地边界转 ISO */
  untilISO: string;
  /** 窗口过滤下界（ms，含） */
  sinceMs: number;
  /** 窗口过滤上界（ms，含） */
  untilMs: number;
  /** 展示标签，如 "本周（07-21 ~ 07-27）" */
  label: string;
}

// 本地日 00:00:00.000
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
// 本地日 23:59:59.999
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
// 本周周一（周一为一周起点）
function mondayOf(d: Date): Date {
  const x = startOfDay(d);
  const dow = x.getDay(); // 0=周日..6=周六
  const back = dow === 0 ? 6 : dow - 1; // 回退到本周一的天数
  x.setDate(x.getDate() - back);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
// MM-DD（展示用）
function md(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function make(since: Date, until: Date, label: string): DateRange {
  return {
    sinceISO: since.toISOString(),
    untilISO: until.toISOString(),
    sinceMs: since.getTime(),
    untilMs: until.getTime(),
    label,
  };
}

/**
 * 计算时间范围。custom 需传 from/to（YYYY-MM-DD，本地日）；缺省/非法回退今天，
 * 起止反了自动交换。
 * @param now 当前时间（注入以便测试）
 */
export function computeRange(
  preset: RangePreset,
  now: Date,
  custom?: { from: string; to: string },
): DateRange {
  switch (preset) {
    case "this-week": {
      const mon = mondayOf(now);
      const sun = endOfDay(addDays(mon, 6));
      return make(mon, sun, `本周（${md(mon)} ~ ${md(sun)}）`);
    }
    case "last-week": {
      const mon = addDays(mondayOf(now), -7);
      const sun = endOfDay(addDays(mon, 6));
      return make(mon, sun, `上周（${md(mon)} ~ ${md(sun)}）`);
    }
    case "last-7": {
      const s = startOfDay(addDays(now, -6));
      const e = endOfDay(now);
      return make(s, e, `近 7 天（${md(s)} ~ ${md(e)}）`);
    }
    case "last-30": {
      const s = startOfDay(addDays(now, -29));
      const e = endOfDay(now);
      return make(s, e, `近 30 天（${md(s)} ~ ${md(e)}）`);
    }
    case "custom": {
      const parse = (v?: string) => {
        // 以本地 00:00 解析（"YYYY-MM-DD" → 本地日）
        const d = v ? new Date(v + "T00:00:00") : now;
        return Number.isNaN(d.getTime()) ? now : d;
      };
      const s = startOfDay(parse(custom?.from));
      const e = endOfDay(parse(custom?.to));
      const [a, b] = s.getTime() <= e.getTime() ? [s, e] : [e, s];
      return make(a, b, `${md(a)} ~ ${md(b)}`);
    }
  }
}
