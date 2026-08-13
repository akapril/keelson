// 用量「额度燃烧」tab：滚动 5h / 本周两窗口 ×（各 provider 消耗 + 成本 + 套餐估算%）
// + 「谁在烧」排名(Top 会话 / Top 项目)。面向订阅制 Claude/Codex(附 Gemini)。
// 纯前端：聚合已有会话 store，不动后端。计算全在 features/usage/usage-calc.ts(纯函数)，
// 本文件只负责取一次 now、注入单价来源、渲染 UI。诚实原则：套餐额度为估算，页面标注醒目免责小字。
// 单价来源：统一复用 store/cost.ts 的可编辑 modelRates/rates + 货币符号（不再硬编码）。
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionsStore } from "@/store/sessions";
import { useCostStore, makeRateForModel } from "@/store/cost";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  sessionsInWindow,
  aggregateByProvider,
  aggregateByModel,
  topSessions,
  topProjects,
  costUsd,
  estimatePercent,
  WINDOW_5H_MS,
  WINDOW_WEEK_MS,
  PLAN_BASELINE_5H,
  PLAN_BASELINE_WEEK,
  type PlanId,
  type ProviderAgg,
  type RateForModel,
} from "@/features/usage/usage-calc";
import type { Session } from "@/types/session";

// ── 展示辅助 ──────────────────────────────────────────────

/** token 数紧凑格式化（k / M）。 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** 成本格式化；无成本(如 Codex total_tokens=0 或未知单价)显示破折号。cur 为货币符号。 */
function fmtCost(amount: number, cur: string): string {
  if (amount <= 0) return "—";
  return `${cur}${amount.toFixed(2)}`;
}

/** Codex 常无 token 归因，改看消息数——用它判断该 provider 是否只有消息可展示。 */
function isMessageOnly(agg: ProviderAgg): boolean {
  return agg.tokens <= 0 && agg.messages > 0;
}

// ── 窗口卡片 ──────────────────────────────────────────────

/** 单个时间窗口内、单个 provider 的一条消耗条。 */
function ProviderRow({
  provider,
  agg,
  sessions,
  rateForModel,
  cur,
}: {
  provider: string;
  agg: ProviderAgg;
  sessions: Session[];
  rateForModel: RateForModel;
  cur: string;
}) {
  const { t } = useTranslation("usage");
  // 该 provider 在本窗口的按模型分解（用于分模型小条与成本）
  const byModel = useMemo(
    () => aggregateByModel(sessions.filter((s) => s.provider === provider)),
    [sessions, provider],
  );
  const modelEntries = Object.entries(byModel).sort((a, b) => b[1] - a[1]);
  const maxTok = modelEntries.length ? modelEntries[0][1] : 0;
  const cost = costUsd(byModel, rateForModel);
  const msgOnly = isMessageOnly(agg);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium capitalize">{provider}</span>
        <span className="text-muted-foreground tabular-nums">
          {msgOnly
            ? t("messagesValue", { count: agg.messages })
            : `${fmtTokens(agg.tokens)} · ${fmtCost(cost, cur)}`}
        </span>
      </div>
      {/* 分模型小条：仅在有 token 归因时展示 */}
      {modelEntries.length > 0 && (
        <div className="space-y-1">
          {modelEntries.map(([model, tok]) => (
            <div key={model} className="flex items-center gap-2">
              <span
                className="w-28 shrink-0 truncate font-mono text-[11px] text-muted-foreground"
                title={model}
              >
                {model}
              </span>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{ width: `${maxTok ? (tok / maxTok) * 100 : 0}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {fmtTokens(tok)} ·{" "}
                {fmtCost((tok / 1_000_000) * rateForModel(model), cur)}
              </span>
            </div>
          ))}
        </div>
      )}
      {msgOnly && (
        <p className="text-[11px] text-muted-foreground">{t("codexNoTokenHint")}</p>
      )}
    </div>
  );
}

/** 一个时间窗口卡片（近 5 小时 / 本周）。 */
function WindowCard({
  title,
  subtitle,
  sessions,
  baseline,
  rateForModel,
  cur,
}: {
  title: string;
  subtitle: string;
  sessions: Session[];
  baseline: Record<PlanId, number>;
  rateForModel: RateForModel;
  cur: string;
}) {
  const { t } = useTranslation("usage");
  const [plan, setPlan] = useState<PlanId>("claude-pro");

  const byProvider = useMemo(() => aggregateByProvider(sessions), [sessions]);
  const providerNames = Object.keys(byProvider).sort(
    (a, b) => byProvider[b].tokens - byProvider[a].tokens,
  );

  // 套餐估算：只统计 Claude 的 token 参与「已用 %」（额度针对 Claude 订阅）
  const claudeTokens = byProvider.claude?.tokens ?? 0;
  const percent = estimatePercent(claudeTokens, baseline[plan]);
  const clamped = Math.min(percent, 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {providerNames.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("windowEmpty")}
          </p>
        ) : (
          <div className="space-y-4">
            {providerNames.map((p) => (
              <ProviderRow
                key={p}
                provider={p}
                agg={byProvider[p]}
                sessions={sessions}
                rateForModel={rateForModel}
                cur={cur}
              />
            ))}
          </div>
        )}

        {/* 套餐估算层 */}
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("planEstimateLabel")}
            </span>
            <Select value={plan} onValueChange={(v) => setPlan(v as PlanId)}>
              <SelectTrigger className="h-7 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude-pro">{t("plan.pro")}</SelectItem>
                <SelectItem value="claude-max5x">{t("plan.max5x")}</SelectItem>
                <SelectItem value="claude-max20x">{t("plan.max20x")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${
                percent >= 100 ? "bg-destructive" : "bg-primary"
              }`}
              style={{ width: `${clamped}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold tabular-nums">
              {t("estimatedUsed", { percent: percent.toFixed(0) })}
            </span>
            {/* 醒目免责小字：诚实标注估算，不可省 */}
            <span className="text-[11px] text-amber-600 dark:text-amber-500">
              {t("estimateDisclaimer")}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── 「谁在烧」排名 ────────────────────────────────────────

function BurnRanking({
  sessions,
  rateForModel,
  cur,
}: {
  sessions: Session[];
  rateForModel: RateForModel;
  cur: string;
}) {
  const { t } = useTranslation("usage");
  const sessRows = useMemo(
    () => topSessions(sessions, 8, rateForModel),
    [sessions, rateForModel],
  );
  const projRows = useMemo(
    () => topProjects(sessions, 8, rateForModel),
    [sessions, rateForModel],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Top 会话 */}
      <Card>
        <CardHeader>
          <CardTitle>{t("topSessionsTitle")}</CardTitle>
          <CardDescription>{t("topSessionsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {sessRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("windowEmpty")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("colProject")}</TableHead>
                  <TableHead>{t("colModel")}</TableHead>
                  <TableHead className="text-right">{t("colUsage")}</TableHead>
                  <TableHead className="text-right">{t("colCost")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessRows.map((r) => (
                  <TableRow key={r.session_id}>
                    <TableCell className="max-w-[140px] truncate" title={r.project_path}>
                      <span className="font-medium">{r.project_name}</span>
                      <span className="ml-1 text-[11px] capitalize text-muted-foreground">
                        {r.provider}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[120px] truncate font-mono text-[11px]" title={r.model}>
                      {r.model}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.tokens > 0
                        ? fmtTokens(r.tokens)
                        : t("messagesValue", { count: r.messages })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtCost(r.cost, cur)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Top 项目 */}
      <Card>
        <CardHeader>
          <CardTitle>{t("topProjectsTitle")}</CardTitle>
          <CardDescription>{t("topProjectsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {projRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("windowEmpty")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("colProject")}</TableHead>
                  <TableHead className="text-right">{t("colSessions")}</TableHead>
                  <TableHead className="text-right">{t("colUsage")}</TableHead>
                  <TableHead className="text-right">{t("colCost")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projRows.map((r) => (
                  <TableRow key={r.project_path || r.project_name}>
                    <TableCell className="max-w-[160px] truncate font-medium" title={r.project_path}>
                      {r.project_name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.sessionCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.tokens > 0
                        ? fmtTokens(r.tokens)
                        : t("messagesValue", { count: r.messages })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtCost(r.cost, cur)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── tab 主体 ──────────────────────────────────────────────

export default function QuotaBurnTab() {
  const { t } = useTranslation("usage");
  const sessions = useSessionsStore((s) => s.sessions);
  const scanned = useSessionsStore((s) => s.scanned);
  const load = useSessionsStore((s) => s.load);

  // 单价来源：复用 cost store 的可编辑 modelRates/rates + 货币符号
  const config = useCostStore((s) => s.config);
  const rateForModel = useMemo(() => makeRateForModel(config), [config]);
  const cur = config.currency;

  // 排名窗口切换：默认近 5 小时，可切本周
  const [rankWindow, setRankWindow] = useState<"5h" | "week">("5h");

  useEffect(() => {
    void load();
  }, [load]);

  // now 只在组件里取一次，传给纯函数（纯函数不碰 Date.now）
  const now = Date.now();
  const win5h = useMemo(
    () => sessionsInWindow(sessions, now, WINDOW_5H_MS),
    [sessions, now],
  );
  const winWeek = useMemo(
    () => sessionsInWindow(sessions, now, WINDOW_WEEK_MS),
    [sessions, now],
  );
  const rankSessions = rankWindow === "5h" ? win5h : winWeek;

  // 空态：后端已扫描完且确实无会话
  const noData = scanned && sessions.length === 0;

  if (noData) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          {t("emptyState")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 两张窗口卡 */}
      <div className="grid gap-4 md:grid-cols-2">
        <WindowCard
          title={t("window5hTitle")}
          subtitle={t("window5hSubtitle")}
          sessions={win5h}
          baseline={PLAN_BASELINE_5H}
          rateForModel={rateForModel}
          cur={cur}
        />
        <WindowCard
          title={t("windowWeekTitle")}
          subtitle={t("windowWeekSubtitle")}
          sessions={winWeek}
          baseline={PLAN_BASELINE_WEEK}
          rateForModel={rateForModel}
          cur={cur}
        />
      </div>

      {/* 谁在烧 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{t("burnTitle")}</h2>
          <Tabs
            value={rankWindow}
            onValueChange={(v) => setRankWindow(v as "5h" | "week")}
          >
            <TabsList>
              <TabsTrigger value="5h">{t("tab5h")}</TabsTrigger>
              <TabsTrigger value="week">{t("tabWeek")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <BurnRanking sessions={rankSessions} rateForModel={rateForModel} cur={cur} />
      </section>
    </div>
  );
}
