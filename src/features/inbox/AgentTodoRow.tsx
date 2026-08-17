// AgentTodoRow —— Agent 待办收件箱单行：状态徽标 + 项目/任务名 + 队友名 + 摘要 + 行内动作 + 展开详情。
import { useState } from "react";
import { useAgentRunActions } from "@/features/board/useAgentRunActions";
import { pendingRunSummary } from "@/features/board/agent-todo";
import { useAgentStore } from "@/store/agents";
import { useBoardStore } from "@/store/board";
import { providerLabel } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { AgentRun, AgentRunStatus } from "@/types/agent";

// ── 状态徽标映射（仅待决策状态，与 AgentRunPanel 保持一致）──────────────────────
const RUN_STATUS_BADGE: Partial<Record<AgentRunStatus, { label: string; cls: string }>> = {
  review:  { label: "待审", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  blocked: { label: "受阻", cls: "bg-red-500/15 text-red-700 dark:text-red-400" },
};

// ── 相对时间标签（简版，不依赖 i18n，硬编码中文；Task 6 负责 i18n 化）───────────
function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const min = 60_000, hour = 3_600_000, day = 86_400_000;
  if (diff < hour) return `${Math.max(1, Math.floor(diff / min))} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── id 兜底：取尾 6 位 ────────────────────────────────────────────────────────────
function shortId(id: string): string {
  return id.slice(-6);
}

// ── Props ────────────────────────────────────────────────────────────────────────
interface Props {
  run: AgentRun;
  /** 动作（合并/打回/重派）完成后回调，供列表重拉 */
  onDone: () => void;
}

/**
 * Agent 待办收件箱单行。
 *
 * - 状态徽标（待审/受阻）+ 项目名 + 任务标题 + 队友名 + pendingRunSummary 摘要 + 相对时间。
 * - 行内按钮：合并（仅 review，no_change 时禁用+提示）/ 打回 / 重派。
 * - 展开区：log_tail（等宽 pre 可滚）+ diff_stat。
 */
export function AgentTodoRow({ run, onDone }: Props) {
  // 决策动作（成功后触发 onDone 重拉列表）
  const { busy, merge, discard, redispatch } = useAgentRunActions(onDone);

  // 展开/折叠详情区
  const [expanded, setExpanded] = useState(false);

  // ── 队友名：从 agents store 按 run.agent 反查，否则回退 providerLabel ──────────
  const agents = useAgentStore((s) => s.agents);
  const agentProfile = run.agent ? agents.find((a) => a.id === run.agent) ?? null : null;
  const agentDisplayName = agentProfile
    ? `${agentProfile.emoji ? `${agentProfile.emoji} ` : ""}${agentProfile.name}`
    : providerLabel(run.provider);

  // ── 项目名/任务标题：从 board store 查，缺失兜底 id 尾 6 位 ──────────────────
  const projects = useBoardStore((s) => s.projects);
  const tasks = useBoardStore((s) => s.tasks);
  const projectName = projects.find((p) => p.id === run.project)?.name ?? shortId(run.project);
  const taskTitle = tasks.find((t) => t.id === run.task)?.title ?? shortId(run.task);

  // 状态徽标
  const badge = RUN_STATUS_BADGE[run.status];

  // 摘要（review→diff_stat 或"无改动"；blocked→blocker）
  const summary = pendingRunSummary(run);

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* ── 主信息行 ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
        {/* 状态徽标 */}
        {badge && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
              badge.cls,
            )}
          >
            {badge.label}
          </span>
        )}

        {/* 项目名 */}
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {projectName}
        </span>

        {/* 任务标题 */}
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {taskTitle}
        </span>

        {/* 队友名 */}
        <span className="shrink-0 text-xs text-muted-foreground">{agentDisplayName}</span>

        {/* 摘要（截断） */}
        {summary && (
          <span className="max-w-[14rem] shrink-0 truncate text-xs text-muted-foreground" title={summary}>
            {summary}
          </span>
        )}

        {/* 相对时间 */}
        {run.started && (
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            {relativeTime(run.started)}
          </span>
        )}

        {/* 展开/折叠按钮 */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "折叠详情" : "展开详情"}
          className="ml-1 shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          {/* 简单 SVG 箭头，避免额外 icon 依赖 */}
          <svg
            className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="4,6 8,10 12,6" />
          </svg>
        </button>
      </div>

      {/* ── 行内动作按钮 ─────────────────────────────────────────────────────── */}
      <div className="flex gap-2 border-t border-border/50 px-3 py-2">
        {/* 合并：仅 review 态显示；no_change 时禁用并附提示 */}
        {run.status === "review" && (
          <Button
            size="sm"
            onClick={() => void merge(run)}
            disabled={busy || run.no_change}
            title={run.no_change ? "Agent 未产生任何文件变更，无需合并" : "将 Agent 结果合并进主分支"}
            className="h-7 text-xs"
          >
            合并
          </Button>
        )}

        {/* 打回：review 和 blocked 态均显示 */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void discard(run)}
          disabled={busy}
          className="h-7 text-xs"
        >
          打回
        </Button>

        {/* 重派：review 和 blocked 态均显示；简单调用，无 ropts（待办行无实时日志面板） */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void redispatch(run)}
          disabled={busy}
          className="h-7 text-xs"
        >
          重派
        </Button>

        {/* no_change 时的附加提示文字（仅 review） */}
        {run.status === "review" && run.no_change && (
          <span className="self-center text-xs text-muted-foreground">无文件变更</span>
        )}
      </div>

      {/* ── 展开详情区：log_tail（等宽可滚）+ diff_stat ───────────────────── */}
      {expanded && (
        <div className="border-t border-border/50 px-3 pb-3 pt-2">
          {/* diff_stat（变更摘要） */}
          {run.diff_stat && (
            <div className="mb-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                变更摘要
              </p>
              <pre className="rounded bg-muted px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-all">
                {run.diff_stat}
              </pre>
            </div>
          )}

          {/* blocker（受阻原因） */}
          {run.status === "blocked" && run.blocker && (
            <div className="mb-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                受阻原因
              </p>
              <p className="rounded bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                {run.blocker}
              </p>
            </div>
          )}

          {/* log_tail（执行日志尾部，终端风格） */}
          {run.log_tail ? (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                执行日志
              </p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-zinc-950 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-zinc-100 dark:bg-black">
                {run.log_tail}
              </pre>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">暂无日志</p>
          )}
        </div>
      )}
    </div>
  );
}
