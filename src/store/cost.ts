// 成本单价配置：每个 provider 每百万 token 的价格 + 货币符号。纯前端 localStorage 持久化。
import { create } from "zustand";
import type { CostRates } from "@/features/usage/aggregate";

const STORAGE_KEY = "rework-cost-config";

export interface CostConfig {
  rates: CostRates; // 每百万 token 单价
  currency: string; // 展示用符号，如 "$" / "¥"
}

// 默认单价为占位估算值，用户可在页面改；单位：货币/百万 token
export const DEFAULT_COST_CONFIG: CostConfig = {
  rates: { claude: 3, codex: 2, openai: 0.6, anthropic: 3 },
  currency: "$",
};

function load(): CostConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COST_CONFIG;
    const parsed = JSON.parse(raw) as Partial<CostConfig>;
    return {
      rates: { ...DEFAULT_COST_CONFIG.rates, ...(parsed.rates ?? {}) },
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
  setCurrency: (currency) => {
    const next = { ...get().config, currency };
    set({ config: next });
    persist(next);
  },
}));
