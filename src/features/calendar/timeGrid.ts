// 时间轴几何/时刻换算纯函数 —— 周/日视图拖拽改期 + 点空白新建共用。
// 全部为无副作用纯函数，便于 vitest 单测（这类数学易错，必须覆盖）。
import { HOUR_PX } from "./WeekView";

/**
 * 把分钟数吸附到最近的 step 的整数倍（四舍五入），并夹到 [0, maxMin]。
 * 例：snapMinutes(552, 15) = 555（552/15=36.8→37→555=09:15）。
 * @param min  原始分钟数（距 0:00）
 * @param step 吸附步长（分钟，默认 15）
 * @param maxMin 上限（默认 24*60，即 0..1440）
 */
export function snapMinutes(min: number, step = 15, maxMin = 24 * 60): number {
  if (step <= 0) return clamp(Math.round(min), 0, maxMin);
  const snapped = Math.round(min / step) * step;
  return clamp(snapped, 0, maxMin);
}

/** 数值夹取到 [lo, hi]。 */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 由指针纵坐标换算成「距 0:00 的分钟数」（未吸附）。
 * 时间轴网格内容高度 = 24 * HOUR_PX，顶端 = gridTop（含滚动已抵消）。
 * @param clientY 指针的 clientY
 * @param gridTop 网格内容顶端在视口中的 y（getBoundingClientRect().top，已随滚动变化）
 * @returns 分钟数（未夹取；调用方通常再走 snapMinutes 吸附并夹取）
 */
export function minuteFromY(clientY: number, gridTop: number): number {
  const offsetPx = clientY - gridTop;
  return (offsetPx / HOUR_PX) * 60;
}

/**
 * 由指针横坐标换算成落在第几列（0 起），用于周视图 7 等宽天列跨列判断。
 * 列区间 = [gridLeft, gridLeft + gridWidth]，等分 colCount 份。
 * @param clientX  指针的 clientX
 * @param gridLeft 天列区（不含左侧刻度列）的左边界 x
 * @param gridWidth 天列区总宽度
 * @param colCount 天列数（周视图=7，日视图=1）
 * @returns 列序号，夹取到 [0, colCount-1]
 */
export function dayIndexFromX(
  clientX: number,
  gridLeft: number,
  gridWidth: number,
  colCount: number,
): number {
  if (colCount <= 1 || gridWidth <= 0) return 0;
  const ratio = (clientX - gridLeft) / gridWidth;
  const idx = Math.floor(ratio * colCount);
  return clamp(idx, 0, colCount - 1);
}

/**
 * 把「距 0:00 的分钟数」格式化为 "HH:mm"（夹到 0..1439，超界按 23:59 处理）。
 */
export function minutesToHM(min: number): string {
  const m = clamp(Math.round(min), 0, 24 * 60 - 1);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * 在 "HH:mm" 基础上加 delta 分钟，返回新的 "HH:mm"（夹到当天 0..1439）。
 * 解析失败按 delta 从 0:00 起算。
 */
export function addMinutesToHM(hm: string, delta: number): string {
  const base = hmToMinutes(hm) ?? 0;
  return minutesToHM(base + delta);
}

/**
 * 解析 "HH:mm" 为分钟数；非法返回 null（与 WeekView.parseHM 同义，此处独立以免循环耦合渲染逻辑）。
 */
export function hmToMinutes(hm: string | undefined): number | null {
  if (!hm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * 计算时段事件的时长（分钟）。无合法 end 或 end<=start 时回退 60 分钟，
 * 与 layoutDayEvents 的默认时长口径一致，保证拖拽后时长稳定。
 */
export function durationMin(startTime: string | undefined, endTime: string | undefined): number {
  const s = hmToMinutes(startTime);
  if (s === null) return 60;
  const e = hmToMinutes(endTime);
  if (e === null || e <= s) return 60;
  return e - s;
}
