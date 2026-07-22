// 工作报告页 —— 选时间范围 + 项目范围 → AI 生成 Markdown 工作报告 → 复制 / 存为文档。
// 数据源：Git 提交 + 完成任务 + AI 会话（见 features/report/generateReport.ts）。
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
import { currentUserId } from "@/lib/pb";
import { createDocRecord } from "@/lib/pb/docs";
import { computeRange, type RangePreset } from "@/features/report/report-range";
import { generateReport, type ReportScope } from "@/features/report/generateReport";

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

  const [preset, setPreset] = useState<RangePreset>("this-week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [scopeId, setScopeId] = useState<string>("all"); // "all" | projectId
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [needConfig, setNeedConfig] = useState(false);

  // 进页面拉一次项目列表（范围下拉用）
  useEffect(() => {
    void useBoardStore.getState().loadProjects();
  }, []);

  // 当前选择对应的时间范围（自定义时依赖两个日期输入）
  const range = useMemo(
    () => computeRange(preset, new Date(), { from: customFrom, to: customTo }),
    [preset, customFrom, customTo],
  );

  const handleGenerate = async () => {
    const cfg = useSettingsStore.getState().aiConfig;
    const isCli = cfg.provider === "claude-cli" || cfg.provider === "codex-cli";
    if (!isCli && !cfg.api_key) {
      setNeedConfig(true);
      return;
    }
    setNeedConfig(false);
    setGenerating(true);
    setResult(null);
    try {
      const scope: ReportScope = scopeId === "all" ? "all" : { projectId: scopeId };
      const md = await generateReport(range, scope, cfg);
      setResult(md);
    } catch (e) {
      toast.error(`生成失败：${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setGenerating(false);
    }
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
      const doc = await createDocRecord({
        owner: currentUserId(),
        // 单项目范围时挂到该项目；全部项目则不挂（跨项目文档）
        projects: scopeId === "all" ? [] : [scopeId],
        title: `工作报告 ${range.label}`,
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

        {/* 项目范围 + 生成 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">项目范围</span>
          <select
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
            className="min-w-40 rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="all">全部项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">·  {range.label}</span>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => void handleGenerate()}
            disabled={generating}
          >
            <HugeiconsIcon icon={Analytics01Icon} strokeWidth={2} />
            {generating ? "生成中…" : "生成报告"}
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
          <p className="py-16 text-center text-sm text-muted-foreground">
            正在采集素材并生成报告…
          </p>
        ) : result ? (
          <div className="mx-auto max-w-3xl">
            {/* 操作栏 */}
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{range.label}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button variant="outline" size="xs" onClick={handleCopy}>
                  <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
                  复制
                </Button>
                <Button variant="outline" size="xs" onClick={() => void handleSaveDoc()} disabled={saving}>
                  <HugeiconsIcon icon={File01Icon} strokeWidth={2} />
                  {saving ? "保存中…" : "存为文档"}
                </Button>
                <Button variant="outline" size="xs" onClick={() => void handleGenerate()}>
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
