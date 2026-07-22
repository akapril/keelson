// 工作报告页 —— 选时间范围 + 项目范围 + 模板 → 后台异步生成 → 复制 / 存为文档。
// 数据源：Git 提交 + 完成任务 + AI 会话（见 features/report/generateReport.ts）。
// 生成走 report-job store（后台任务，完成推通知），页面离开再回来仍能看到结果。
import { useEffect, useMemo, useState } from "react";
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
import type { Prompt } from "@/types/prompt";
import { computeRange, type RangePreset } from "@/features/report/report-range";
import { type ReportScope } from "@/features/report/generateReport";

// 时间范围预设（顺序即展示顺序）
const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "this-week", label: "本周" },
  { key: "last-week", label: "上周" },
  { key: "last-7", label: "近 7 天" },
  { key: "last-30", label: "近 30 天" },
  { key: "custom", label: "自定义" },
];

export default function ReportPage() {
  const navigate = useNavigate();
  const projects = useBoardStore((s) => s.projects);
  // 后台生成任务状态（离开页面再回来仍可见）
  const status = useReportJobStore((s) => s.status);
  const result = useReportJobStore((s) => s.result);
  const runJob = useReportJobStore((s) => s.run);

  const [preset, setPreset] = useState<RangePreset>("this-week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [scopeId, setScopeId] = useState<string>("all"); // "all" | projectId
  const [templateId, setTemplateId] = useState<string>(""); // "" = 默认（无模板）
  const [templates, setTemplates] = useState<Prompt[]>([]);
  const [saving, setSaving] = useState(false);
  const [needConfig, setNeedConfig] = useState(false);

  const generating = status === "running";

  // 进页面拉项目列表（范围下拉）+ 指令库（模板下拉）
  useEffect(() => {
    void useBoardStore.getState().loadProjects();
    void listPrompts().then(setTemplates).catch(() => {});
  }, []);

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
    const systemPrompt = templates.find((t) => t.id === templateId)?.content;
    // 后台启动（不阻塞）；完成时 store 推通知，页面响应式显示结果
    runJob({ range, scope, cfg, systemPrompt });
  };

  const handleCopy = () => {
    if (!result) return;
    void navigator.clipboard.writeText(result).then(
      () => toast.success("已复制报告"),
      () => toast.error("复制失败"),
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
        title: `工作报告 ${label}`,
        content: result,
      });
      toast.success("已存为文档");
      navigate(`/docs/${doc.id}`);
    } catch (e) {
      toast.error(`存为文档失败：${String(e)}`);
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
          <h1 className="text-lg font-semibold">工作报告</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            汇总一段时间的提交、完成任务与会话活动，AI 生成可分享的工作报告。
          </p>
        </div>
      </div>

      {/* 控制区 */}
      <div className="mb-4 shrink-0 space-y-3 rounded-xl border border-border bg-card p-4">
        {/* 时间范围预设 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">时间范围</span>
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
                aria-label="起始日期"
              />
              <span className="text-xs text-muted-foreground">~</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                aria-label="结束日期"
              />
            </span>
          )}
        </div>

        {/* 项目范围 + 模板 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">项目范围</span>
          <select
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
            className="min-w-32 rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="all">全部项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <span className="ml-2 text-xs font-medium text-muted-foreground">模板</span>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="min-w-32 rounded-md border border-border bg-background px-2 py-1 text-xs"
            title="模板来自「指令库」；缺省用内置报告格式"
          >
            <option value="">默认格式</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>

        {/* 范围提示 + 生成 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{range.label}</span>
          {templates.length === 0 && (
            <button
              type="button"
              onClick={() => navigate("/prompts")}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              去指令库建报告模板
            </button>
          )}
          <Button
            size="sm"
            className="ml-auto"
            onClick={handleGenerate}
            disabled={generating}
          >
            <HugeiconsIcon icon={Analytics01Icon} strokeWidth={2} />
            {generating ? "后台生成中…" : "生成报告"}
          </Button>
        </div>
      </div>

      {/* 未配置 AI 服务引导 */}
      {needConfig && (
        <div className="mb-4 shrink-0 rounded-xl border border-border bg-card p-4 text-sm">
          <p className="text-foreground">尚未配置 AI 服务</p>
          <p className="mt-1 text-xs text-muted-foreground">
            前往设置页填写 API Key（或使用本地 CLI）后即可生成报告。
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/settings")}>
            去设置
          </Button>
        </div>
      )}

      {/* 结果区 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {generating ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <p className="text-sm">正在后台采集素材并生成报告…</p>
            <p className="text-xs">可离开本页去做别的，生成完会有通知提醒。</p>
          </div>
        ) : status === "error" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <p className="text-sm text-destructive">生成失败，请重试</p>
            <Button variant="outline" size="sm" onClick={handleGenerate}>
              重新生成
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
                  复制
                </Button>
                <Button variant="outline" size="xs" onClick={() => void handleSaveDoc()} disabled={saving}>
                  <HugeiconsIcon icon={File01Icon} strokeWidth={2} />
                  {saving ? "保存中…" : "存为文档"}
                </Button>
                <Button variant="outline" size="xs" onClick={handleGenerate}>
                  <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
                  重新生成
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
            <p className="text-sm">选择时间范围与项目，点「生成报告」</p>
          </div>
        )}
      </div>
    </div>
  );
}
