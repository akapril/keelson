// 成本控制塔 tab：用量趋势（按天 token）+ provider 分布 + 成本估算 + 单价编辑。
// 数据源为本地会话（total_tokens 近似），成本按用户配置的每百万 token 单价估算。
// 由旧 usage.tsx（成本控制塔）抽出为 tab 组件；单价来自 store/cost.ts（可编辑·localStorage 持久化）。
import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useSessionsStore } from "@/store/sessions";
import { useCostStore } from "@/store/cost";
import { aggregateUsage, type DailyPoint } from "@/features/usage/aggregate";
import { Input } from "@/components/ui/input";

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

export default function CostTowerTab() {
  // 沿用旧塔文案：仍在 shell 命名空间的 usage.* 下（未搬迁，避免重复翻译）
  const { t } = useTranslation("shell");
  const sessions = useSessionsStore((s) => s.sessions);
  const load = useSessionsStore((s) => s.load);
  const { config, setRate, setModelRate } = useCostStore();
  const [days, setDays] = useState(30);

  const RANGES = [
    { label: t("usage.rangeLast7"), days: 7 },
    { label: t("usage.rangeLast30"), days: 30 },
    { label: t("usage.rangeAll"), days: 3650 },
  ];

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
    <div className="flex flex-col gap-5">
      {/* 区间选择（塔专属；页头标题/描述由外层页面提供） */}
      <div className="flex justify-end gap-1">
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

      {/* 概览卡片 */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label={t("usage.statSessions")} value={String(summary.totalSessions)} />
        <Stat label={t("usage.statTokens")} value={fmtTokens(summary.totalTokens)} />
        <Stat label={t("usage.statCost")} value={`${cur}${summary.totalCost.toFixed(2)}`} />
      </div>

      {/* 按天趋势 */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">{t("usage.chartTitle")}</h2>
        <DailyTrend data={tokenData.daily} />
      </section>

      {/* 按 provider 分布 + 单价编辑 */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">{t("usage.providerTitle")}</h2>
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
                {t("usage.priceLabel", { cur })}
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
            <p className="py-8 text-center text-sm text-muted-foreground">{t("usage.emptyData")}</p>
          )}
        </div>
      </section>

      {/* 按项目分布（哪个项目最烧钱） */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">{t("usage.projectTitle")}</h2>
        <TokenBar data={tokenData.byProject} xKey="project_name" limit={12} angle={-20} height={50} />

        <div className="mt-4 space-y-2">
          {summary.byProject.map((p) => (
            <div key={p.project_path || p.project_name} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium" title={p.project_path}>
                {p.project_name}
              </span>
              <span className="w-20 shrink-0 text-right text-muted-foreground">
                {t("usage.sessionUnit", { count: p.sessions })}
              </span>
              <span className="w-32 shrink-0 text-right text-muted-foreground">
                {fmtTokens(p.tokens)} · {cur}
                {p.cost.toFixed(2)}
              </span>
            </div>
          ))}
          {summary.byProject.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("usage.emptyData")}</p>
          )}
        </div>
      </section>

      {/* 按模型分布 + 单价编辑（opus/sonnet 单价差 5 倍，分开才看得清） */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-medium">{t("usage.modelTitle")}</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {t("usage.modelDesc")}
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
                {t("usage.priceLabel", { cur })}
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
            <p className="py-8 text-center text-sm text-muted-foreground">{t("usage.emptyData")}</p>
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
