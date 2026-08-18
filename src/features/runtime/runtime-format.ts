// 运行时卡纯函数（可测）：uptime 文案 / 容量文案 / 内存条百分比。

/** 秒 → 人类可读运行时长（<60s 显秒；<1h 显分；否则时+分）。 */
export function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor(secs / 60) % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** agent 容量文案："在跑 / 上限"。 */
export function capacityLabel(running: number, cap: number): string {
  return `${running} / ${cap}`;
}

/** 内存条百分比（0-100 取整；total<=0 返回 0）。 */
export function memBarPercent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}
