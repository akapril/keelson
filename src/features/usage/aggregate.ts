// 用量聚合纯函数：把会话数组聚成「按天 token 趋势 + 按 provider 分布 + 成本估算」。
// 只依赖会话的 provider / total_tokens / created_at；无副作用，便于单测。
import type { Session } from "@/types/session";

/** 每个 provider 的单价（每百万 token 的货币金额）。 */
export interface CostRates {
  [provider: string]: number;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  tokens: number;
}

export interface ProviderStat {
  provider: string;
  sessions: number;
  tokens: number;
  cost: number;
}

export interface UsageSummary {
  totalSessions: number;
  totalTokens: number;
  totalCost: number;
  byProvider: ProviderStat[];
  daily: DailyPoint[];
}

/** 取 RFC3339 时间戳的日期部分（UTC，稳定用于按天分组）。 */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** 成本 = tokens / 1e6 × 每百万单价。 */
export function estimateCost(tokens: number, ratePerMillion: number): number {
  return (tokens / 1_000_000) * ratePerMillion;
}

/**
 * 聚合会话用量。
 * @param days 仅统计最近 N 天（按 created_at 与当前时间比较）；传大值（如 365）即全量。
 */
export function aggregateUsage(
  sessions: Session[],
  rates: CostRates,
  days: number,
): UsageSummary {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const inRange = sessions.filter((s) => {
    const t = Date.parse(s.created_at);
    return Number.isNaN(t) ? true : t >= cutoff;
  });

  // 按 provider 聚合
  const provMap = new Map<string, ProviderStat>();
  // 按天聚合
  const dayMap = new Map<string, number>();

  let totalTokens = 0;
  let totalCost = 0;

  for (const s of inRange) {
    const tokens = s.total_tokens || 0;
    totalTokens += tokens;
    const rate = rates[s.provider] ?? 0;
    const cost = estimateCost(tokens, rate);
    totalCost += cost;

    const ps = provMap.get(s.provider) ?? {
      provider: s.provider,
      sessions: 0,
      tokens: 0,
      cost: 0,
    };
    ps.sessions += 1;
    ps.tokens += tokens;
    ps.cost += cost;
    provMap.set(s.provider, ps);

    const dk = dayKey(s.created_at);
    dayMap.set(dk, (dayMap.get(dk) ?? 0) + tokens);
  }

  const byProvider = [...provMap.values()].sort((a, b) => b.tokens - a.tokens);
  const daily = [...dayMap.entries()]
    .map(([date, tokens]) => ({ date, tokens }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    totalSessions: inRange.length,
    totalTokens,
    totalCost,
    byProvider,
    daily,
  };
}
