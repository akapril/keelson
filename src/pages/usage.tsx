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

// recharts v3 Tooltip formatter 的 value 参数类型为 number | string | readonly (number|string)[] | undefined
function fmtTooltip(v: number | string | readonly (number | string)[] | undefined): string {
  if (typeof v === "number") return fmtTokens(v);
  return String(v ?? "");
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
              <Tooltip formatter={fmtTooltip} />
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
              <Tooltip formatter={fmtTooltip} />
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
