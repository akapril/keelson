// 成本控制塔：用量趋势（按天 token）+ provider 分布 + 成本估算 + 单价编辑。
// 数据源为本地会话（total_tokens 近似），成本按用户配置的每百万 token 单价估算。
import { memo, useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useSessionsStore } from "@/store/sessions";
import { useCostStore } from "@/store/cost";
import { aggregateUsage, type DailyPoint } from "@/features/usage/aggregate";
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

// recharts v3 Tooltip formatter 的 value 参数类型为 number | string | readonly (number|string)[] | undefined
function fmtTooltip(v: number | string | readonly (number | string)[] | undefined): string {
  if (typeof v === "number") return fmtTokens(v);
  return String(v ?? "");
}

// 图表组件 memo 化：只依赖 token 数据（不含单价）。改单价时数据引用不变 → 图表不重绘，
// 消除「单价输入框每键一次重绘 4 个 recharts」的卡顿。
const DailyTrend = memo(function DailyTrend({ data }: { data: DailyPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={fmtTokens} tick={{ fontSize: 11 }} width={48} />
          <Tooltip formatter={fmtTooltip} />
          <Line type="monotone" dataKey="tokens" stroke="var(--primary)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

// 通用「按 X 的 token 柱状图」：数据引用稳定时 memo 跳过重绘。limit 截前 N 条。
const TokenBar = memo(function TokenBar({
  data,
  xKey,
  limit,
  angle,
  height,
  fontSize = 11,
}: {
  data: object[];
  xKey: string;
  limit?: number;
  angle?: number;
  height?: number;
  fontSize?: number;
}) {
  const shown = limit ? data.slice(0, limit) : data;
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={shown}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey={xKey}
            tick={{ fontSize }}
            interval={angle != null ? 0 : undefined}
            angle={angle}
            textAnchor={angle != null ? "end" : undefined}
            height={height}
          />
          <YAxis tickFormatter={fmtTokens} tick={{ fontSize: 11 }} width={48} />
          <Tooltip formatter={fmtTooltip} />
          <Bar dataKey="tokens" fill="var(--primary)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});

export default function UsagePage() {
  const sessions = useSessionsStore((s) => s.sessions);
  const load = useSessionsStore((s) => s.load);
  const { config, setRate, setModelRate } = useCostStore();
  const [days, setDays] = useState(30);

  useEffect(() => {
    void load();
  }, [load]);

  // 成本相关（含单价）：改单价时重算——但只驱动文本数字，不驱动图表。
  const summary = useMemo(
    () => aggregateUsage(sessions, config.rates, days, config.modelRates),
    [sessions, config.rates, days, config.modelRates],
  );
  // 图表用 token 数据：只依赖 sessions/days（不含单价），引用稳定 → memo 图表改单价不重绘。
  const tokenData = useMemo(
    () => aggregateUsage(sessions, {}, days, {}),
    [sessions, days],
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
        <DailyTrend data={tokenData.daily} />
      </section>

      {/* 按 provider 分布 + 单价编辑 */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">按 Provider</h2>
        <TokenBar data={tokenData.byProvider} xKey="provider" />

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

      {/* 按项目分布（哪个项目最烧钱） */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">按项目</h2>
        <TokenBar data={tokenData.byProject} xKey="project_name" limit={12} angle={-20} height={50} />

        <div className="mt-4 space-y-2">
          {summary.byProject.map((p) => (
            <div key={p.project_path || p.project_name} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium" title={p.project_path}>
                {p.project_name}
              </span>
              <span className="w-20 shrink-0 text-right text-muted-foreground">{p.sessions} 会话</span>
              <span className="w-32 shrink-0 text-right text-muted-foreground">
                {fmtTokens(p.tokens)} · {cur}
                {p.cost.toFixed(2)}
              </span>
            </div>
          ))}
          {summary.byProject.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">该时间范围内暂无会话数据</p>
          )}
        </div>
      </section>

      {/* 按模型分布 + 单价编辑（opus/sonnet 单价差 5 倍，分开才看得清） */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-medium">按模型</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          token 含 input/output/cache 各类（同口径）；单价优先按模型，未设则回退 provider 单价。
        </p>
        <TokenBar data={tokenData.byModel} xKey="model" limit={12} angle={-20} height={56} fontSize={10} />

        <div className="mt-4 space-y-2">
          {summary.byModel.map((m) => (
            <div key={m.model} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={`${m.model}（${m.provider}）`}>
                {m.model}
              </span>
              <span className="w-32 shrink-0 text-right text-muted-foreground">
                {fmtTokens(m.tokens)} · {cur}
                {m.cost.toFixed(2)}
              </span>
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                单价 {cur}/百万
                <Input
                  type="number"
                  value={config.modelRates[m.model] ?? ""}
                  placeholder={String(config.rates[m.provider] ?? 0)}
                  onChange={(e) => setModelRate(m.model, Number(e.target.value) || 0)}
                  className="h-7 w-24"
                />
              </label>
            </div>
          ))}
          {summary.byModel.length === 0 && (
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
