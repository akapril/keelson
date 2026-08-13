// 用量「额度燃烧」纯计算模块。
// 设计原则：所有函数都是纯函数——不依赖 store、不调用 Date.now()。
// 「当前时间 now」一律作为参数由调用方传入，便于单测复现固定时刻。
// 计算逻辑与 UI 完全分离：本文件只做聚合/成本/估算，页面只负责渲染。
import type { Session } from "@/types/session";

// ──────────────────────────────────────────────────────────
// 常量：套餐基线（单价来源已统一到 store/cost.ts，本模块不再内置价表）
// ──────────────────────────────────────────────────────────
//
// 说明：额度燃烧的美元/成本一律复用 store/cost.ts 里「可编辑的 modelRates/rates + 货币符号」，
// 不再维护第二套硬编码价表。成本相关纯函数改为接收「单价查询函数 rateForModel」由调用方注入。

/** 套餐类型标识（用于下拉选择与基线查表）。 */
export type PlanId = "claude-pro" | "claude-max5x" | "claude-max20x";

/**
 * 套餐「近 5 小时」滚动窗口的估算 token 基线（社区粗估, 官方不公布确切额度, 仅供参考·可改）。
 * Max 5x / 20x 为官方相对倍率（相对 Pro）。用于 estimatePercent 估算「已用 ~X%」。
 */
export const PLAN_BASELINE_5H: Record<PlanId, number> = {
  "claude-pro": 44_000,
  "claude-max5x": 220_000,
  "claude-max20x": 880_000,
};

/**
 * 套餐「周窗口」的估算 token 基线（比 5h 更粗略, 官方不公布, 仅供参考·可改）。
 */
export const PLAN_BASELINE_WEEK: Record<PlanId, number> = {
  "claude-pro": 300_000,
  "claude-max5x": 1_500_000,
  "claude-max20x": 6_000_000,
};

/** 常用窗口毫秒常量（供页面复用，避免各处手算魔法数）。 */
export const WINDOW_5H_MS = 5 * 60 * 60 * 1000;
export const WINDOW_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ──────────────────────────────────────────────────────────
// 聚合结果类型
// ──────────────────────────────────────────────────────────

/** 每个 provider 的聚合统计。 */
export interface ProviderAgg {
  /** token 总量（Σ total_tokens）。 */
  tokens: number;
  /** 消息总数（Σ message_count）。 */
  messages: number;
  /** 会话条数。 */
  sessionCount: number;
}

/** Top 会话排名条目。 */
export interface SessionRank {
  session_id: string;
  provider: string;
  project_name: string;
  project_path: string;
  /** 主导模型：by_model 中 token 最多的模型名；无 by_model 时回退 provider。 */
  model: string;
  tokens: number;
  messages: number;
  /** 该会话的美元成本估算（无 token 时为 0）。 */
  cost: number;
}

/** Top 项目排名条目（按 project_path 聚合）。 */
export interface ProjectRank {
  project_path: string;
  project_name: string;
  tokens: number;
  messages: number;
  sessionCount: number;
  /** 该项目的美元成本估算。 */
  cost: number;
}

// ──────────────────────────────────────────────────────────
// 窗口过滤
// ──────────────────────────────────────────────────────────

/**
 * 取 updated_at 落在滚动窗口 [nowMs - windowMs, nowMs] 内的会话。
 * 归属策略：会话级——整段会话计入其 updated_at 所在窗口（不做逐消息拆分）。
 * 边界：区间闭合（含端点）；updated_at 无法解析（NaN）时视为不在窗口内。
 */
export function sessionsInWindow(
  sessions: Session[],
  nowMs: number,
  windowMs: number,
): Session[] {
  const start = nowMs - windowMs;
  return sessions.filter((s) => {
    const t = Date.parse(s.updated_at);
    if (Number.isNaN(t)) return false;
    return t >= start && t <= nowMs;
  });
}

// ──────────────────────────────────────────────────────────
// 聚合
// ──────────────────────────────────────────────────────────

/**
 * 合并所有会话的 by_model → Record<model, tokens>。
 * 缺 by_model（旧数据）的会话不计入按模型统计（其总量仍可由 provider 聚合体现）。
 */
export function aggregateByModel(sessions: Session[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sessions) {
    const bm = s.by_model;
    if (!bm) continue;
    for (const [model, tok] of Object.entries(bm)) {
      out[model] = (out[model] ?? 0) + (tok || 0);
    }
  }
  return out;
}

/**
 * 按 provider 聚合 → Record<provider, {tokens, messages, sessionCount}>。
 * tokens = Σ total_tokens；messages = Σ message_count；sessionCount = 会话条数。
 */
export function aggregateByProvider(
  sessions: Session[],
): Record<string, ProviderAgg> {
  const out: Record<string, ProviderAgg> = {};
  for (const s of sessions) {
    const agg = (out[s.provider] ??= { tokens: 0, messages: 0, sessionCount: 0 });
    agg.tokens += s.total_tokens || 0;
    agg.messages += s.message_count || 0;
    agg.sessionCount += 1;
  }
  return out;
}

// ──────────────────────────────────────────────────────────
// 成本估算
// ──────────────────────────────────────────────────────────

/**
 * 单价查询函数：给定模型名（无 by_model 时会传入 provider 名当作模型名），
 * 返回每 100 万 token 的单价。实现由调用方注入（复用 store/cost.ts 的可编辑单价）。
 */
export type RateForModel = (model: string) => number;

/**
 * 由「模型→token」映射估算总成本。
 * 成本 = Σ (tokens / 1e6 × rateForModel(model))；单价来源由调用方注入。
 */
export function costUsd(
  byModel: Record<string, number>,
  rateForModel: RateForModel,
): number {
  let sum = 0;
  for (const [model, tok] of Object.entries(byModel)) {
    sum += ((tok || 0) / 1_000_000) * rateForModel(model);
  }
  return sum;
}

/** 单个会话的成本：有 by_model 用之；无则按 provider 名近似（作为模型名查单价）。 */
function sessionCost(s: Session, rateForModel: RateForModel): number {
  if (s.by_model && Object.keys(s.by_model).length > 0) {
    return costUsd(s.by_model, rateForModel);
  }
  // 无 by_model：用 provider 名当作模型名查单价。
  return ((s.total_tokens || 0) / 1_000_000) * rateForModel(s.provider);
}

/** 取会话的主导模型（by_model 中 token 最多者）；无 by_model 时回退 provider。 */
function dominantModel(s: Session): string {
  const bm = s.by_model;
  if (!bm) return s.provider;
  let best = "";
  let bestTok = -1;
  for (const [model, tok] of Object.entries(bm)) {
    if ((tok || 0) > bestTok) {
      bestTok = tok || 0;
      best = model;
    }
  }
  return best || s.provider;
}

// ──────────────────────────────────────────────────────────
// 「谁在烧」排名
// ──────────────────────────────────────────────────────────

/**
 * 消耗排名比较：tokens 优先降序；当两侧 tokens 都为 0 时退化为按 messages 降序。
 * 用于 topSessions / topProjects 的统一排序口径。
 */
function burnCompare(
  a: { tokens: number; messages: number },
  b: { tokens: number; messages: number },
): number {
  if (a.tokens !== b.tokens) return b.tokens - a.tokens;
  // tokens 相等（含都为 0）时按 messages 兜底排序
  return b.messages - a.messages;
}

/** Top N 会话（按消耗：tokens 优先，全 0 退 messages）。rateForModel 注入单价来源。 */
export function topSessions(
  sessions: Session[],
  n: number,
  rateForModel: RateForModel,
): SessionRank[] {
  const ranked: SessionRank[] = sessions.map((s) => ({
    session_id: s.session_id,
    provider: s.provider,
    project_name: s.project_name || s.project_path || "(unknown)",
    project_path: s.project_path,
    model: dominantModel(s),
    tokens: s.total_tokens || 0,
    messages: s.message_count || 0,
    cost: sessionCost(s, rateForModel),
  }));
  ranked.sort(burnCompare);
  return ranked.slice(0, n);
}

/** Top N 项目（按 project_path 聚合，消耗排名口径同上）。rateForModel 注入单价来源。 */
export function topProjects(
  sessions: Session[],
  n: number,
  rateForModel: RateForModel,
): ProjectRank[] {
  const map = new Map<string, ProjectRank>();
  for (const s of sessions) {
    // key 用 project_path 去重（不同项目可能同名）；空路径回退项目名
    const key = s.project_path || s.project_name || "(unknown)";
    const cur =
      map.get(key) ??
      ({
        project_path: s.project_path,
        project_name: s.project_name || s.project_path || "(unknown)",
        tokens: 0,
        messages: 0,
        sessionCount: 0,
        cost: 0,
      } as ProjectRank);
    cur.tokens += s.total_tokens || 0;
    cur.messages += s.message_count || 0;
    cur.sessionCount += 1;
    cur.cost += sessionCost(s, rateForModel);
    map.set(key, cur);
  }
  const ranked = [...map.values()];
  ranked.sort(burnCompare);
  return ranked.slice(0, n);
}

// ──────────────────────────────────────────────────────────
// 套餐额度估算
// ──────────────────────────────────────────────────────────

/**
 * 估算「已用百分比」= consumedTokens / baseline × 100（可 >100）。
 * baseline 来自 PLAN_BASELINE_*（估算·官方不公布确切额度·仅供参考）。
 * baseline 为 0 或非法时返回 0，避免除零/NaN。
 */
export function estimatePercent(consumedTokens: number, baseline: number): number {
  if (!baseline || baseline <= 0) return 0;
  return (consumedTokens / baseline) * 100;
}
