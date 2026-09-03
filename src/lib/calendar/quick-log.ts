// 快速记录解析 —— 从「刚才做了什么」文本里识别 @项目 + 中文时间/时长，关联项目并预填日期/时刻，
// 剩余文本当标题。纯函数（无副作用、可注入 now），供日历快录条与命令面板「记一笔」共用；配 vitest。
// 不引 NLP 库：目标中文表达是可枚举小集合，自写正则解析即可（YAGNI）。
import { format } from "date-fns";
import { addMinutesToHM } from "@/features/calendar/timeGrid";
import type { BoardProject } from "@/types/board";

/** 快录事件默认色（indigo）——日历快录条与命令面板「记一笔」共用，避免各写各的漂移。 */
export const DEFAULT_EVENT_COLOR = "#6366f1";

export interface ParsedQuickLog {
  /** 剥离 @项目 与时间 token 后的事件标题 */
  title: string;
  /** 关联到的项目 id（未匹配到则空串） */
  project: string;
  /** 识别到的日期（yyyy-MM-dd）；未识别则缺省（调用方回退今天/落点日） */
  start?: string;
  /** 识别到的开始时刻（HH:mm）；未识别则缺省（调用方回退当前时刻） */
  startTime?: string;
  /** 由「时长」合成的结束时刻（HH:mm）；无时长则缺省 */
  endTime?: string;
  /** 是否要到点提醒：文本含「提醒」意图时为 true（纯流水账无此词=不提醒）。调用方据此写 remind_at。 */
  remind?: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
// 中文星期 → getDay() 值（0=周日）；「末」按周六
const WEEKDAY: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, 末: 6,
};

/** 解析中文日期，返回命中子串（供从标题剥离）+ 目标 Date。未命中返回 null。 */
function parseDateZh(text: string, now: Date): { matched: string; date: Date } | null {
  const atMidnight = () => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  // 相对日（大后天须在后天之前匹配，避免被「后天」截断）
  const rel: [RegExp, number][] = [
    [/大后天/, 3],
    [/后天/, 2],
    [/明[天日]/, 1],
    [/今[天日]/, 0],
  ];
  for (const [re, off] of rel) {
    const m = re.exec(text);
    if (m) {
      const d = atMidnight();
      d.setDate(d.getDate() + off);
      return { matched: m[0], date: d };
    }
  }
  // 下周X / 本周X / 周X / 星期X / 礼拜X
  const w = text.match(/(下|本|这)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天末])/);
  if (w) {
    const dow = WEEKDAY[w[2]];
    const weekOffset = w[1] === "下" ? 1 : 0;
    const d = atMidnight();
    d.setDate(d.getDate() + (dow - d.getDay()) + weekOffset * 7);
    return { matched: w[0], date: d };
  }
  // M月D日 / M月D号
  const md = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
  if (md) {
    const d = atMidnight();
    d.setMonth(parseInt(md[1], 10) - 1, parseInt(md[2], 10));
    return { matched: md[0], date: d };
  }
  // M/D（两侧须为边界，避免误吞其它数字）
  const slash = text.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?=\s|$)/);
  if (slash) {
    const d = atMidnight();
    d.setMonth(parseInt(slash[1], 10) - 1, parseInt(slash[2], 10));
    return { matched: slash[0].trim(), date: d };
  }
  return null;
}

/** 解析中文时刻（须含 : 或「点」），返回命中子串 + 时/分。未命中返回 null。 */
function parseTimeZh(text: string): { matched: string; hh: number; mm: number } | null {
  const re =
    /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2})(?:[:：]([0-5]?\d)|\s*点\s*(半|[0-5]?\d)?\s*分?)?/;
  const m = re.exec(text);
  if (!m) return null;
  const [matched, period, hStr, colonMin, dianMin] = m;
  // 必须含 : 或 点 才算时刻，否则是普通数字（如时长里的「3」）
  if (!/[:：点]/.test(matched)) return null;
  const isColon = colonMin != null;
  let hh = parseInt(hStr, 10);
  let mm = 0;
  if (colonMin != null) mm = parseInt(colonMin, 10);
  else if (dianMin) mm = dianMin === "半" ? 30 : parseInt(dianMin, 10) || 0;
  if (period && /下午|傍晚|晚上|夜里/.test(period)) {
    if (hh < 12) hh += 12;
  } else if (period && /凌晨|早上|早晨|上午/.test(period)) {
    if (hh === 12) hh = 0;
  } else if (period && /中午/.test(period)) {
    hh = 12;
  } else if (!isColon && hh >= 1 && hh <= 6) {
    // 无时段词的「H点」：1-6 点按工作时段启发式判为下午（可见于 toast/预览，错了到弹窗改）
    hh += 12;
  }
  if (hh > 23) hh = 23;
  if (mm > 59) mm = 59;
  return { matched, hh, mm };
}

/** 解析中文时长，返回命中子串 + 分钟数。未命中返回 null。 */
function parseDurationZh(text: string): { matched: string; minutes: number } | null {
  let m = text.match(/半\s*(?:个)?\s*小时/);
  if (m) return { matched: m[0], minutes: 30 };
  m = text.match(/(\d+(?:\.\d+)?)\s*(?:个)?\s*(?:小时|h|hr|hrs)/i);
  if (m) return { matched: m[0], minutes: Math.round(parseFloat(m[1]) * 60) };
  m = text.match(/(\d+)\s*(?:分钟|分|mins|min)/i);
  if (m) return { matched: m[0], minutes: parseInt(m[1], 10) };
  return null;
}

/**
 * 解析快录文本：
 * - `@项目`：完全相等优先、其次最短前缀匹配，命中则关联并剥离 token；未匹配保留原文不乱关联。
 * - 中文日期/时刻/时长：识别到才回填 start/startTime/endTime（未识别一律缺省，故无时间的句子行为与纯手填一致）。
 * - 时长合成 endTime：以「开始时刻 ?? 当前时刻」为锚 + 时长。
 * - 全部命中子串从标题剥离，剩余整理空白即 title；剥空则回退项目名或原文。
 * @param now 基准时间（注入以便测试「明天」等相对日确定性），默认当前时间。
 */
export function parseQuickLog(
  text: string,
  projects: BoardProject[],
  now: Date = new Date(),
): ParsedQuickLog {
  const raw = text.trim();
  let working = raw;
  let project = "";

  // 1. @项目（@ 是字面锚点，不与中文时间 token 重叠，先处理）
  const pm = raw.match(/@(\S+)/);
  if (pm) {
    const token = pm[1].toLowerCase();
    const exact = projects.find((p) => p.name.toLowerCase() === token);
    const prefixes = projects
      .filter((p) => p.name.toLowerCase().startsWith(token))
      .sort((a, b) => a.name.length - b.name.length);
    const matched = exact ?? prefixes[0];
    if (matched) {
      project = matched.id;
      working = working.replace(pm[0], " ");
    }
  }

  // 2. 日期 → 时刻 → 时长（时刻先于时长，避免「点M分」被时长误吞）
  const dateR = parseDateZh(working, now);
  if (dateR) working = working.replace(dateR.matched, " ");
  const timeR = parseTimeZh(working);
  if (timeR) working = working.replace(timeR.matched, " ");
  const durR = parseDurationZh(working);
  if (durR) working = working.replace(durR.matched, " ");

  // 3. 提醒意图：含「提醒」即标记要到点提醒，并剥离「提醒我?」token（时间已在上一步剥掉，不干扰）。
  //    纯流水账（无「提醒」二字）→ remind 缺省 → 不通知。
  let remind = false;
  const remindMatch = working.match(/提醒(我)?/);
  if (remindMatch) {
    remind = true;
    working = working.replace(remindMatch[0], " ");
  }

  const result: ParsedQuickLog = {
    title: working.replace(/\s+/g, " ").trim(),
    project,
  };
  if (remind) result.remind = true;
  if (dateR) result.start = format(dateR.date, "yyyy-MM-dd");
  if (timeR) result.startTime = `${pad(timeR.hh)}:${pad(timeR.mm)}`;
  if (durR) {
    const anchor = result.startTime ?? format(now, "HH:mm");
    result.endTime = addMinutesToHM(anchor, durR.minutes);
  }
  // 标题剥空：有项目用项目名，否则回退原文（不至于建出无标题事件）
  if (!result.title) {
    const p = projects.find((pr) => pr.id === project);
    result.title = p ? p.name : raw;
  }
  return result;
}

/**
 * 由解析结果算「提醒时间」ISO（UTC，秒级 `YYYY-MM-DDTHH:MM:SSZ`）。
 * - 仅当 `parsed.remind` 为真时返回非空；无提醒意图返回 `""`（=不提醒）。
 * - 日期取 `parsed.start ?? fallbackDate`；时刻取 `parsed.startTime ?? "09:00"`（无时刻默认早上 9 点）。
 * - 定宽 UTC 便于与后台 worker 的「当前时间」字典序比较（同格式=同序）。
 *
 * @param fallbackDate 无识别日期时的回退日（yyyy-MM-dd，通常为今天/落点日）
 */
export function computeRemindAt(parsed: ParsedQuickLog, fallbackDate: string): string {
  if (!parsed.remind) return "";
  const date = parsed.start ?? fallbackDate;
  const time = parsed.startTime ?? "09:00";
  const d = new Date(`${date}T${time}:00`); // 本地时区解析 → 下方转 UTC
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 19) + "Z";
}
