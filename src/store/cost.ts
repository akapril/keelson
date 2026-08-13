// 成本单价配置：provider / 模型 每百万 token 的价格 + 货币符号。纯前端 localStorage 持久化。
import { create } from "zustand";
import type { CostRates, ModelRates } from "@/features/usage/aggregate";

const STORAGE_KEY = "keelson-cost-config";

export interface CostConfig {
  rates: CostRates; // 按 provider 的每百万 token 单价（回退用）
  modelRates: ModelRates; // 按模型的每百万 token 单价（优先）
  currency: string; // 展示用符号，如 "$" / "¥"
}

// 内置占位单价表（货币/百万 token，混合 in/out+cache 的粗估，用户可改）。
// 模型名用前缀近似匹配的原始串常见形态；未命中则回退 provider 单价。
export const DEFAULT_MODEL_RATES: ModelRates = {
  "claude-opus-4-8": 15,
  "claude-sonnet-4-6": 3,
  "claude-3-5-haiku": 0.8,
  "gpt-5.1-codex-max": 2,
  "gpt-5.1": 2,
  "gpt-4o": 2.5,
  "gpt-4o-mini": 0.15,
};

// 默认单价为占位估算值，用户可在页面改；单位：货币/百万 token
export const DEFAULT_COST_CONFIG: CostConfig = {
  rates: { claude: 3, codex: 2, openai: 0.6, anthropic: 3 },
  modelRates: DEFAULT_MODEL_RATES,
  currency: "$",
};

/**
 * 由成本配置构造「模型名 → 每百万 token 单价」查询函数（单价的唯一来源）。
 * 匹配顺序：
 *   1) modelRates 精确命中模型名；
 *   2) modelRates 前缀匹配（会话里模型名常带日期后缀，如 claude-opus-4-8-20260101，
 *      而配置键为 claude-opus-4-8）——取「最长匹配前缀」，避免短键误命中；
 *   3) 回退 provider 单价（额度燃烧无 by_model 时会把 provider 名当模型名传入）；
 *   4) 仍未命中回退 0（未知模型不臆造价格，成本显示为「—」）。
 */
export function makeRateForModel(cfg: CostConfig): (model: string) => number {
  const modelKeys = Object.keys(cfg.modelRates);
  return (model: string): number => {
    // 1) 精确命中
    if (cfg.modelRates[model] != null) return cfg.modelRates[model];
    // 2) 前缀匹配：取最长匹配键（更具体优先）
    let best = "";
    for (const key of modelKeys) {
      if (model.startsWith(key) && key.length > best.length) best = key;
    }
    if (best) return cfg.modelRates[best];
    // 3) 回退 provider 单价（model 此时可能就是 provider 名）
    if (cfg.rates[model] != null) return cfg.rates[model];
    // 4) 未知：0（不臆造）
    return 0;
  };
}

function load(): CostConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COST_CONFIG;
    const parsed = JSON.parse(raw) as Partial<CostConfig>;
    return {
      rates: { ...DEFAULT_COST_CONFIG.rates, ...(parsed.rates ?? {}) },
      modelRates: { ...DEFAULT_COST_CONFIG.modelRates, ...(parsed.modelRates ?? {}) },
      currency: parsed.currency ?? DEFAULT_COST_CONFIG.currency,
    };
  } catch {
    return DEFAULT_COST_CONFIG;
  }
}

function persist(cfg: CostConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* 隐私模式等写入失败静默忽略 */
  }
}

interface CostState {
  config: CostConfig;
  setRate: (provider: string, rate: number) => void;
  setModelRate: (model: string, rate: number) => void;
  setCurrency: (currency: string) => void;
}

export const useCostStore = create<CostState>((set, get) => ({
  config: load(),
  setRate: (provider, rate) => {
    const next: CostConfig = {
      ...get().config,
      rates: { ...get().config.rates, [provider]: rate },
    };
    set({ config: next });
    persist(next);
  },
  setModelRate: (model, rate) => {
    const next: CostConfig = {
      ...get().config,
      modelRates: { ...get().config.modelRates, [model]: rate },
    };
    set({ config: next });
    persist(next);
  },
  setCurrency: (currency) => {
    const next = { ...get().config, currency };
    set({ config: next });
    persist(next);
  },
}));
