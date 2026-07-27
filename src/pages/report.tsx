// 工作报告页 —— 选时间范围 + 项目范围 + 模板 → 后台异步生成 → 复制 / 存为文档。
// 数据源：Git 提交 + 完成任务 + AI 会话（见 features/report/generateReport.ts）。
// 生成走 report-job store（后台任务，完成推通知），页面离开再回来仍能看到结果。
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Analytics01Icon, Copy01Icon, File01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";
import { useBoardStore } from "@/store/board";
import { useSettingsStore } from "@/store/settings";
import { useReportJobStore } from "@/store/report-job";
import { currentUserId } from "@/lib/pb";
import { createDocRecord } from "@/lib/pb/docs";
import { listPrompts } from "@/lib/pb/prompts";
import { promptType } from "@/features/prompts/prompt-utils";
import { ensureDefaultPromptsSeeded } from "@/features/prompts/seed-defaults";
import type { Prompt } from "@/types/prompt";

// 记住上次选的报告模板 → 它就是你的「默认」（不选则用内置格式）
const TEMPLATE_KEY = "rework-report-template";
import { computeRange, type RangePreset } from "@/features/report/report-range";
import { type ReportScope } from "@/features/report/generateReport";

export default function ReportPage() {
  const { t } = useTranslation("shell");
  const { t: tCommon } = useTranslation("common");
  const navigate = useNavigate();
  const projects = useBoardStore((s) => s.projects);
  // 后台生成任务状态（离开页面再回来仍可见）
  const status = useReportJobStore((s) => s.status);
  const result = useReportJobStore((s) => s.result);
  const runJob = useReportJobStore((s) => s.run);

  // 时间范围预设（顺序即展示顺序）
  const PRESETS: { key: RangePreset; label: string }[] = [
    { key: "this-week", label: t("report.rangeThisWeek") },
    { key: "last-week", label: t("report.rangeLastWeek") },
    { key: "last-7", label: t("report.rangeLast7") },
    { key: "last-30", label: t("report.rangeLast30") },
    { key: "custom", label: t("report.rangeCustom") },
  ];

  const [preset, setPreset] = useState<RangePreset>("this-week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [scopeId, setScopeId] = useState<string>("all"); // "all" | projectId
  // "" = 内置默认格式；否则为报告模板 id。初值取上次选择（记住即为默认）。
  const [templateId, setTemplateId] = useState<string>(() => {
    try {
      return localStorage.getItem(TEMPLATE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [templates, setTemplates] = useState<Prompt[]>([]);
  const [saving, setSaving] = useState(false);
  const [needConfig, setNeedConfig] = useState(false);

  const generating = status === "running";

  // 进页面拉项目列表（范围下拉）+ 指令库中「报告模板」类型（模板下拉）
  useEffect(() => {
    void useBoardStore.getState().loadProjects();
    void (async () => {
      // 先确保内置报告默认已种进库（幂等），再拉取，使它出现在模板下拉
      await ensureDefaultPromptsSeeded();
      try {
        const list = await listPrompts();
        const reports = list.filter((p) => promptType(p) === "report");
        setTemplates(reports);
        // 记住的模板仍在则沿用；否则默认选第一个模板（库里通常至少有内置那条种子）；
        // 一个模板都没有（如未重建/被删光）时留 ""，生成走内置默认兜底。
        setTemplateId((id) =>
          id && reports.some((tmpl) => tmpl.id === id) ? id : reports[0]?.id ?? "",
        );
      } catch {
        /* 拉取失败：模板下拉留空，仍可用内置默认 */
      }
    })();
  }, []);

  // 选择模板即持久化（下次进来默认沿用）
  const chooseTemplate = (id: string) => {
    setTemplateId(id);
    try {
      localStorage.setItem(TEMPLATE_KEY, id);
    } catch {
      /* 忽略写入失败 */
    }
  };

  // 当前选择对应的时间范围（自定义时依赖两个日期输入）
  const range = useMemo(
    () => computeRange(preset, new Date(), { from: customFrom, to: customTo }),
    [preset, customFrom, customTo],
  );

  const handleGenerate = () => {
    const cfg = useSettingsStore.getState().aiConfig;
    const isCli = cfg.provider === "claude-cli" || cfg.provider === "codex-cli";
    if (!isCli && !cfg.api_key) {
      setNeedConfig(true);
      return;
    }
    setNeedConfig(false);
    const scope: ReportScope = scopeId === "all" ? "all" : { projectId: scopeId };
    // 选了模板用模板正文；否则传 undefined → generateReport 用内置默认格式
    const systemPrompt = templates.find((tmpl) => tmpl.id === templateId)?.content;
    // 后台启动（不阻塞）；完成时 store 推通知，页面响应式显示结果
    runJob({ range, scope, cfg, systemPrompt });
  };

  const handleCopy = () => {
    if (!result) return;
    void navigator.clipboard.writeText(result).then(
      () => toast.success(t("report.toast.copySuccess")),
      () => toast.error(t("report.toast.copyError")),
    );
  };

  const handleSaveDoc = async () => {
    if (!result) return;
    setSaving(true);
    try {
      // 标题用「生成时」的范围标签（离开页面再回来控件会重置，range.label 可能已变）
      const label = useReportJobStore.getState().rangeLabel || range.label;
      const doc = await createDocRecord({
        owner: currentUserId(),
        // 单项目范围时挂到该项目；全部项目则不挂（跨项目文档）
        projects: scopeId === "all" ? [] : [scopeId],
        title: `${t("report.title")} ${label}`,
        content: result,
      });
      toast.success(t("report.toast.saveSuccess"));
      navigate(`/docs/${doc.id}`);
    } catch (e) {
      toast.error(t("report.toast.saveError", { msg: String(e) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      {/* 页头 */}
      <div className="mb-5 flex shrink-0 items-center gap-3">
        <HugeiconsIcon icon={Analytics01Icon} strokeWidth={2} className="size-6 text-primary" />
        <div>
          <h1 className="text-lg font-semibold">{t("report.title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("report.description")}
          </p>
        </div>
      </div>

      {/* 控制区 */}
      <div className="mb-4 shrink-0 space-y-3 rounded-xl border border-border bg-card p-4">
        {/* 时间范围预设 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{t("report.rangeLabel")}</span>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                preset === p.key
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {p.label}
            </button>
          ))}
          {preset === "custom" && (
            <span className="flex items-center gap-1.5">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                aria-label={t("report.ariaStartDate")}
              />
              <span className="text-xs text-muted-foreground">~</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                aria-label={t("report.ariaEndDate")}
              />
            </span>
          )}
        </div>

        {/* 项目范围 + 模板 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{t("report.projectLabel")}</span>
          <select
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
            className="min-w-32 rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="all">{t("report.allProjects")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <span className="ml-2 text-xs font-medium text-muted-foreground">{t("report.templateLabel")}</span>
          <select
            value={templateId}
            onChange={(e) => chooseTemplate(e.target.value)}
            className="min-w-32 rounded-md border border-border bg-background px-2 py-1 text-xs"
            title={t("report.templateTitle")}
          >
            {/* 有模板时不再显示冗余的「内置默认」——库里那条种子即默认；
                一个模板都没有时才给内置兜底选项 */}
            {templates.length === 0 && <option value="">{t("report.templateDefault")}</option>}
            {templates.map((tmpl) => (
              <option key={tmpl.id} value={tmpl.id}>
                {tmpl.title}
              </option>
            ))}
          </select>
        </div>

        {/* 范围提示 + 生成 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{range.label}</span>
          <Button
            size="sm"
            className="ml-auto"
            onClick={handleGenerate}
            disabled={generating}
          >
            <HugeiconsIcon icon={Analytics01Icon} strokeWidth={2} />
            {generating ? t("report.generating") : t("report.generateBtn")}
          </Button>
        </div>
      </div>

      {/* 未配置 AI 服务引导 */}
      {needConfig && (
        <div className="mb-4 shrink-0 rounded-xl border border-border bg-card p-4 text-sm">
          <p className="text-foreground">{t("report.noAiTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("report.noAiDesc")}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/settings")}>
            {t("report.goToSettings")}
          </Button>
        </div>
      )}

      {/* 结果区 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {generating ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <p className="text-sm">{t("report.generatingHint")}</p>
            <p className="text-xs">{t("report.generatingSubHint")}</p>
          </div>
        ) : status === "error" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <p className="text-sm text-destructive">{t("report.errorHint")}</p>
            <Button variant="outline" size="sm" onClick={handleGenerate}>
              {t("report.generateBtn")}
            </Button>
          </div>
        ) : result ? (
          <div className="mx-auto max-w-3xl">
            {/* 操作栏 */}
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{useReportJobStore.getState().rangeLabel}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button variant="outline" size="xs" onClick={handleCopy}>
                  <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
                  {tCommon("action.copy")}
                </Button>
                <Button variant="outline" size="xs" onClick={() => void handleSaveDoc()} disabled={saving}>
                  <HugeiconsIcon icon={File01Icon} strokeWidth={2} />
                  {saving ? t("report.saving") : t("report.saveBtn")}
                </Button>
                <Button variant="outline" size="xs" onClick={handleGenerate}>
                  <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
                  {t("report.generateBtn")}
                </Button>
              </div>
            </div>
            {/* 报告正文 */}
            <div className="rounded-xl border border-border bg-card p-5">
              <Markdown content={result} />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <HugeiconsIcon icon={Analytics01Icon} strokeWidth={1.5} className="size-10 opacity-50" />
            <p className="text-sm">{t("report.emptyHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
