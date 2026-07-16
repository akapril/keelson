# ① 用量/成本控制塔 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 聚合本地全部会话的 `total_tokens` × provider × 时间，给出用量趋势图 + 按 provider 分布 + 可配单价的成本估算，作为独立侧边栏页面「成本控制塔」。

**Architecture:** 纯前端。数据源为已有的 `useSessionsStore.sessions`（每条含 `provider`、`total_tokens`、`created_at`）。聚合逻辑抽成纯函数 `src/features/usage/aggregate.ts`（可单测）。单价配置存 localStorage（仿 `rework-ai-config`），页面用 recharts 渲染折线（按日 token）与柱状（按 provider）。

**Tech Stack:** React 19 + TS，zustand，recharts（新增），Tailwind。

## Global Constraints

- 注释与日志默认中文。
- 会话字段现状：**只有 `total_tokens`（number），无 input/output 拆分、无 `model`**。成本按 `total_tokens × 单价` 近似，UI 需注明「按总 token 估算」。
- `created_at` / `updated_at` 为 RFC3339 字符串。
- 单价配置 localStorage key 用 `rework-cost-config`，结构含默认值 + 浅合并（仿 settings.ts 容错）。
- 新页面注册需同时改 `src/router.tsx`（`<Route>`）与 `src/lib/navigation.ts`（工作区组）。范例见 dashboard(`/dashboard`)、docs(`/docs`)。
- 图表库 recharts 兼容 React 19；若 peerDeps 报警，用 `npm i recharts --legacy-peer-deps`。

---

### Task 1: 引入 recharts 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装**

Run: `npm i recharts`
（若因 React 19 peer 冲突失败：`npm i recharts --legacy-peer-deps`）
Expected: `package.json` dependencies 出现 `recharts`。

- [ ] **Step 2: 验证可导入**

Run: `node -e "require.resolve('recharts'); console.log('ok')"`
Expected: 输出 `ok`。

- [ ] **Step 3: 提交**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): 新增 recharts 用于用量趋势图"
```

---

### Task 2: 用量聚合纯函数（含成本估算）

**Files:**
- Create: `src/features/usage/aggregate.ts`
- Test: `src/features/usage/aggregate.test.ts`

**Interfaces:**
- Consumes: `Session`（`src/types/session.ts`，用到 `provider`、`total_tokens`、`created_at`）。
- Produces:
  - `interface CostRates { [provider: string]: number }`（每百万 token 单价）
  - `interface DailyPoint { date: string; tokens: number }`
  - `interface ProviderStat { provider: string; sessions: number; tokens: number; cost: number }`
  - `interface UsageSummary { totalSessions: number; totalTokens: number; totalCost: number; byProvider: ProviderStat[]; daily: DailyPoint[] }`
  - `function dayKey(iso: string): string`
  - `function estimateCost(tokens: number, ratePerMillion: number): number`
  - `function aggregateUsage(sessions: Session[], rates: CostRates, days: number): UsageSummary`

- [ ] **Step 1: 写失败测试**

`src/features/usage/aggregate.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { dayKey, estimateCost, aggregateUsage } from "./aggregate";
import type { Session } from "@/types/session";

function s(partial: Partial<Session>): Session {
  return {
    session_id: "x", provider: "claude", project_path: "/p", project_name: "p",
    first_prompt: "", last_prompt: "", created_at: "2026-07-10T08:00:00Z",
    updated_at: "2026-07-10T08:00:00Z", message_count: 1, user_messages: [],
    total_tokens: 0, ...partial,
  };
}

describe("dayKey", () => {
  it("提取 RFC3339 的日期部分（UTC）", () => {
    expect(dayKey("2026-07-10T23:59:00Z")).toBe("2026-07-10");
  });
});

describe("estimateCost", () => {
  it("按每百万 token 单价计算成本", () => {
    expect(estimateCost(1_000_000, 3)).toBeCloseTo(3);
    expect(estimateCost(500_000, 3)).toBeCloseTo(1.5);
    expect(estimateCost(0, 3)).toBe(0);
  });
});

describe("aggregateUsage", () => {
  const rates = { claude: 3, codex: 2 };

  it("汇总总会话数、总 token 与总成本", () => {
    const out = aggregateUsage(
      [
        s({ session_id: "a", provider: "claude", total_tokens: 1_000_000 }),
        s({ session_id: "b", provider: "codex", total_tokens: 500_000 }),
      ],
      rates,
      365,
    );
    expect(out.totalSessions).toBe(2);
    expect(out.totalTokens).toBe(1_500_000);
    expect(out.totalCost).toBeCloseTo(3 + 1); // claude 3 + codex 1
  });

  it("按 provider 分组统计并按 token 降序", () => {
    const out = aggregateUsage(
      [
        s({ session_id: "a", provider: "codex", total_tokens: 100 }),
        s({ session_id: "b", provider: "claude", total_tokens: 900 }),
        s({ session_id: "c", provider: "claude", total_tokens: 100 }),
      ],
      rates,
      365,
    );
    expect(out.byProvider[0].provider).toBe("claude");
    expect(out.byProvider[0].sessions).toBe(2);
    expect(out.byProvider[0].tokens).toBe(1000);
  });

  it("按天聚合 token，日期升序", () => {
    const out = aggregateUsage(
      [
        s({ session_id: "a", created_at: "2026-07-10T08:00:00Z", total_tokens: 100 }),
        s({ session_id: "b", created_at: "2026-07-10T20:00:00Z", total_tokens: 50 }),
        s({ session_id: "c", created_at: "2026-07-12T08:00:00Z", total_tokens: 30 }),
      ],
      rates,
      365,
    );
    expect(out.daily[0]).toEqual({ date: "2026-07-10", tokens: 150 });
    expect(out.daily[out.daily.length - 1]).toEqual({ date: "2026-07-12", tokens: 30 });
  });

  it("未配置单价的 provider 成本按 0 计", () => {
    const out = aggregateUsage(
      [s({ provider: "unknown", total_tokens: 1_000_000 })],
      rates,
      365,
    );
    expect(out.totalCost).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/features/usage/aggregate.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现聚合**

`src/features/usage/aggregate.ts`：

```typescript
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/features/usage/aggregate.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/features/usage/aggregate.ts src/features/usage/aggregate.test.ts
git commit -m "feat(usage): 用量聚合纯函数（按天/按provider/成本估算）+ 单测"
```

---

### Task 3: 成本单价配置（localStorage store）

**Files:**
- Create: `src/store/cost.ts`

**Interfaces:**
- Consumes: `CostRates`（来自 `aggregate.ts`）。
- Produces:
  - `interface CostConfig { rates: CostRates; currency: string }`
  - `const DEFAULT_COST_CONFIG: CostConfig`
  - `useCostStore` with `{ config, setRate(provider, rate), setCurrency(c) }`

- [ ] **Step 1: 实现 store**

`src/store/cost.ts`：

```typescript
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
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/store/cost.ts
git commit -m "feat(usage): 成本单价配置 store（localStorage）"
```

---

### Task 4: 成本控制塔页面（图表 + 单价编辑）

**Files:**
- Create: `src/pages/usage.tsx`

**Interfaces:**
- Consumes: `useSessionsStore`（`sessions`、`load`）、`useCostStore`、`aggregateUsage`、recharts。
- Produces: `export default function UsagePage()`。

- [ ] **Step 1: 实现页面**

`src/pages/usage.tsx`：

```tsx
// 成本控制塔：用量趋势（按天 token）+ provider 分布 + 成本估算 + 单价编辑。
// 数据源为本地会话（total_tokens 近似），成本按用户配置的每百万 token 单价估算。
import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useSessionsStore } from "@/store/sessions";
import { useCostStore } from "@/store/cost";
import { aggregateUsage } from "@/features/usage/aggregate";
import { Input } from "@/components/ui/input";

const RANGES = [
  { label: "近 7 天", days: 7 },
  { label: "近 30 天", days: 30 },
  { label: "全部", days: 3650 },
];

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function UsagePage() {
  const sessions = useSessionsStore((s) => s.sessions);
  const load = useSessionsStore((s) => s.load);
  const { config, setRate } = useCostStore();
  const [days, setDays] = useState(30);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(
    () => aggregateUsage(sessions, config.rates, days),
    [sessions, config.rates, days],
  );

  const cur = config.currency;

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-5 overflow-y-auto p-6">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">成本控制塔</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            按总 token 估算（暂无 input/output 拆分）。单价可在下方编辑，仅本机保存。
          </p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              className={`rounded-lg px-2.5 py-1 text-xs ${
                days === r.days ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {/* 概览卡片 */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="会话数" value={String(summary.totalSessions)} />
        <Stat label="总 Token" value={fmtTokens(summary.totalTokens)} />
        <Stat label="估算成本" value={`${cur}${summary.totalCost.toFixed(2)}`} />
      </div>

      {/* 按天趋势 */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">每日 Token 趋势</h2>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={summary.daily}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmtTokens} tick={{ fontSize: 11 }} width={48} />
              <Tooltip formatter={(v: number) => fmtTokens(v)} />
              <Line type="monotone" dataKey="tokens" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* 按 provider 分布 + 单价编辑 */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">按 Provider</h2>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summary.byProvider}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="provider" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmtTokens} tick={{ fontSize: 11 }} width={48} />
              <Tooltip formatter={(v: number) => fmtTokens(v)} />
              <Bar dataKey="tokens" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 space-y-2">
          {summary.byProvider.map((p) => (
            <div key={p.provider} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 font-medium">{p.provider}</span>
              <span className="w-28 shrink-0 text-muted-foreground">
                {fmtTokens(p.tokens)} · {cur}
                {p.cost.toFixed(2)}
              </span>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                单价 {cur}/百万
                <Input
                  type="number"
                  value={config.rates[p.provider] ?? 0}
                  onChange={(e) => setRate(p.provider, Number(e.target.value) || 0)}
                  className="h-7 w-24"
                />
              </label>
            </div>
          ))}
          {summary.byProvider.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">该时间范围内暂无会话数据</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/pages/usage.tsx
git commit -m "feat(usage): 成本控制塔页面（趋势/分布/单价编辑）"
```

---

### Task 5: 注册路由与侧边栏导航

**Files:**
- Modify: `src/router.tsx`（Route 列表，参照 `/docs` L19）
- Modify: `src/lib/navigation.ts`（工作区组 items）

**Interfaces:**
- Consumes: `UsagePage`（default export）。

- [ ] **Step 1: 加路由**

`src/router.tsx` 顶部 import 区加：

```tsx
import UsagePage from "@/pages/usage";
```

在工作区 Route 列表内（`/docs` 那行附近）加：

```tsx
          <Route path="/usage" element={<UsagePage />} />
```

- [ ] **Step 2: 加侧边栏项**

`src/lib/navigation.ts`：在文件顶部图标 import 中加入一个存在的图标（沿用 hugeicons，选一个折线/图表类，如 `Analytics01Icon`；若不确定图标名，复用已 import 的任意图标，如 `Home01Icon`，避免编译失败）。然后在「工作区」组 items 里、`文档` 项之后插入：

```typescript
      {
        title: "成本控制塔",
        url: "/usage",
        icon: Analytics01Icon, // 若该图标名不存在，改用已 import 的图标
        description: "Token 用量趋势 · 成本预估",
      },
```

> 图标名若报错：先 `grep "Icon" src/lib/navigation.ts` 看已用的导入，替换为其中之一，确保可编译；图标美化留待后续。

- [ ] **Step 3: 构建校验**

Run: `npm run build`
Expected: 通过（页面可路由）。

- [ ] **Step 4: 提交**

```bash
git add src/router.tsx src/lib/navigation.ts
git commit -m "feat(usage): 注册 /usage 路由与侧边栏「成本控制塔」入口"
```

---

### Task 6: 手动验证

**Files:** 无。

- [ ] **Step 1: 运行**

Run: `npm run tauri dev`
Expected: 侧边栏出现「成本控制塔」。

- [ ] **Step 2: 验证**

1. 打开页面 → 概览三卡（会话数/总 token/估算成本）有值。
2. 每日趋势折线、provider 柱状渲染正常。
3. 改某 provider 单价 → 成本卡与该行 cost 实时刷新；刷新应用后单价仍在（localStorage 持久化）。
4. 切「近 7 天 / 近 30 天 / 全部」→ 数据随范围变化。

---

## Self-Review 摘要

- Spec 覆盖：聚合 total_tokens×provider×时间 ✓ Task2；趋势图 ✓ Task4 折线；成本估算 ✓ Task2+3+4；纯前端 ✓ 全程无后端改动。
- 无占位符：聚合函数与页面均为完整代码；仅图标名给出「不存在则替换」的明确回退指令（非占位）。
- 类型一致：`CostRates`/`UsageSummary`/`aggregateUsage` 跨 Task2→4 命名一致；`useCostStore.config.rates` 与 `aggregateUsage(rates)` 同型。
- 已知近似：无 input/output 拆分与 model，UI 已注明「按总 token 估算」——符合 spec 的「纯前端为主 + 估算」定位。
