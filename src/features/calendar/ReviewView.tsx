// 回顾视图 —— GitHub 贡献图式活动热力图 + 按类型总览 + 按项目占比条。
// 只接父级已采集的 material（与 AgendaView 一样自身不拉数据）；统计走 review-stats 纯函数。
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ReportMaterial } from "@/features/report/report-collect";
import type { DateRange } from "@/features/report/report-range";
import {
  buildDailyBuckets,
  aggregateByType,
  aggregateByProject,
} from "@/features/report/review-stats";

// 5 档强度（按当日活动总数）
function intensityClass(total: number): string {
  if (total <= 0) return "bg-muted/40";
  if (total <= 2) return "bg-primary/25";
  if (total <= 5) return "bg-primary/45";
  if (total <= 9) return "bg-primary/70";
  return "bg-primary";
}

export function ReviewView({
  material,
  range,
}: {
  material: ReportMaterial | null;
  range: DateRange;
}) {
  const { t } = useTranslation("calendar");

  const stats = useMemo(() => {
    if (!material) return null;
    const buckets = buildDailyBuckets(material, range);
    const days = [...buckets.keys()]
      .sort()
      .map((k) => ({ key: k, date: new Date(k + "T00:00:00"), ...buckets.get(k)! }));
    const projects = aggregateByProject(material);
    return {
      days,
      type: aggregateByType(material),
      projects,
      maxTotal: Math.max(1, ...projects.map((p) => p.total)),
    };
  }, [material, range]);

  if (!stats) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("page.loading")}</p>
      </div>
    );
  }

  // 热力图首列前置空格：让首日落到对应星期行（getDay 0=周日）
  const lead = stats.days.length ? stats.days[0].date.getDay() : 0;
  const allZero = stats.days.every((d) => d.total === 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 py-4">
        <p className="text-sm text-muted-foreground">{range.label}</p>

        {/* 类型总览 */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <span>
            <b className="text-foreground tabular-nums">{stats.type.commits}</b> {t("activity.commits")}
          </span>
          <span>
            <b className="text-foreground tabular-nums">{stats.type.tasks}</b> {t("activity.tasks")}
          </span>
          <span>
            <b className="text-foreground tabular-nums">{stats.type.sessions}</b> {t("activity.sessions")}
          </span>
        </div>

        {/* 活动热力图（7 行=周日~周六，列=周） */}
        <div className="grid grid-flow-col gap-1" style={{ gridTemplateRows: "repeat(7, 1fr)" }}>
          {Array.from({ length: lead }).map((_, i) => (
            <div key={`lead-${i}`} />
          ))}
          {stats.days.map((d) => (
            <div
              key={d.key}
              title={`${d.key} · ${d.total} ${t("review.items")}`}
              className={`size-3 rounded-sm ${intensityClass(d.total)}`}
            />
          ))}
        </div>

        {/* 按项目占比 */}
        {stats.projects.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-xs font-semibold text-muted-foreground">{t("review.byProject")}</h3>
            {stats.projects.map((p) => (
              <div key={p.label} className="flex items-center gap-2 text-xs">
                <span className="w-28 shrink-0 truncate" title={p.label}>
                  {p.label}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(p.total / stats.maxTotal) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">
                  {p.total}
                </span>
              </div>
            ))}
          </div>
        )}

        {allZero && (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("review.empty")}</p>
        )}
      </div>
    </div>
  );
}
