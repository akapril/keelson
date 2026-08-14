// AgentRunPanel —— Agent 运行详情面板（Sheet 形式；显示日志/diff/状态操作）。
// 打开时拉最新 run → 按状态渲染操作按钮；操作成功 toast + 刷新；失败重抛 + toast。
import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { providerLabel } from "@/lib/providers";
import { listAgentRuns } from "@/lib/pb/agent-runs";
import { ipc } from "@/lib/tauri/ipc";
import type { AgentRun, AgentRunStatus } from "@/types/agent";
import { useAgentLogStore } from "@/store/agent-run-logs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── 状态徽标样式映射（提升到模块顶层，避免组件每次渲染重建对象）────────────────────
const RUN_STATUS_BADGE: Record<AgentRunStatus, { label: string; cls: string }> = {
  running: { label: "执行中", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
  review:  { label: "待审",   cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  blocked: { label: "受阻",   cls: "bg-red-500/15 text-red-700 dark:text-red-400" },
  merged:  { label: "已合并", cls: "bg-green-500/15 text-green-700 dark:text-green-400" },
  discarded: { label: "已打回", cls: "bg-muted text-muted-foreground" },
};

// ── Props ────────────────────────────────────────────────────────────────────
interface AgentRunPanelProps {
  /** 目标任务 ID，打开时用于拉取最新 run */
  taskId: string;
  /** 受控开关 */
  open: boolean;
  /** 关闭回调（用于父组件收起面板） */
  onClose: () => void;
  /** 操作（合并/打回/重派）成功后回调，供父组件刷新徽标等 */
  onRefresh?: () => void;
}

/**
 * Agent Run 详情面板。
 *
 * - 打开时自动 `listAgentRuns(taskId)` 取最新一条 run；
 * - review  → 「合并」`agentMergeRun` / 「打回」`agentDiscardRun`；
 * - blocked → 「打回」+ 「重派」（再次调 `agentRunTask`）；
 * - running → 显示已落 log_tail（P1 不实时订阅）；
 * - no_change 时合并按钮附带提示；
 * - 操作成功 toast + 刷新 run / 关闭面板；失败 toast 并重抛（不吞）。
 */
export function AgentRunPanel({
  taskId,
  open,
  onClose,
  onRefresh,
}: AgentRunPanelProps) {
  // 当前展示的 run（null=加载中或无 run）
  const [run, setRun] = useState<AgentRun | null>(null);
  // 是否正在加载 run 列表
  const [loading, setLoading] = useState(false);
  // 操作按钮禁用态（防止重复点击）
  const [acting, setActing] = useState(false);
  // 实时日志：订阅 agent-run-logs store，执行中边跑边渲染
  const liveLog = useAgentLogStore((s) => s.logs[taskId] ?? "");
  // 日志区 ref，用于 liveLog 变化时自动滚到底部
  const liveLogRef = useRef<HTMLPreElement>(null);

  // liveLog 变化时自动将日志区滚到底部
  useEffect(() => {
    const el = liveLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveLog]);

  /** 拉取最新一条 run（打开时 + 操作成功后调用） */
  const refresh = useCallback(() => {
    if (!taskId) return;
    setLoading(true);
    listAgentRuns(taskId)
      .then((runs) => setRun(runs[0] ?? null))
      .catch((e) => toast.error(`加载 run 失败：${String(e)}`))
      .finally(() => setLoading(false));
  }, [taskId]);

  // 面板打开时立即拉取
  useEffect(() => {
    if (open) refresh();
    else {
      // 关闭时重置状态，避免下次打开闪旧数据
      setRun(null);
      setActing(false);
    }
  }, [open, refresh]);

  /** 合并 run（review 态）*/
  const handleMerge = async () => {
    if (!run || acting) return;
    setActing(true);
    try {
      await ipc.agentMergeRun(run.id);
      toast.success("已将 Agent 结果合并进主分支");
      onRefresh?.();
      // 刷新后关闭面板（run 状态已变 merged，无需继续操作）
      onClose();
    } catch (e) {
      toast.error(`合并失败：${String(e)}`);
      // 重抛，确保调用方 catch 能感知（不吞）
      throw e;
    } finally {
      setActing(false);
    }
  };

  /** 打回 run（review / blocked 态）*/
  const handleDiscard = async () => {
    if (!run || acting) return;
    setActing(true);
    try {
      await ipc.agentDiscardRun(run.id);
      toast.success("已打回此次 Agent 运行");
      onRefresh?.();
      onClose();
    } catch (e) {
      toast.error(`打回失败：${String(e)}`);
      throw e;
    } finally {
      setActing(false);
    }
  };

  /** 重派（blocked 态）：再次用同 provider 发起执行 */
  const handleRedispatch = async () => {
    if (!run || acting) return;
    const provider = run.provider;
    setActing(true);
    try {
      // 先打回当前 blocked run（清理 worktree），再重新执行
      await ipc.agentDiscardRun(run.id);
      // 发起前清空旧日志，让实时日志区从头开始
      useAgentLogStore.getState().reset(taskId);
      // agentRunTask 是流式：通过 onEvent 回调感知增量和完成；这里仅触发，不 await 完整流
      void ipc.agentRunTask(taskId, provider, (e) => {
        if (e.kind === "delta" && e.text) {
          // 增量文本写入 store，面板实时渲染（面板此时可能已关闭，写入无副作用）
          useAgentLogStore.getState().append(taskId, e.text);
        } else if (e.kind === "done") {
          toast.success(`${providerLabel(provider)} 重派完成`);
          onRefresh?.();
          refresh();
        }
      });
      toast.message(`已重派给 ${providerLabel(provider)}，执行中…`);
      onClose();
    } catch (e) {
      toast.error(`重派失败：${String(e)}`);
      throw e;
    } finally {
      setActing(false);
    }
  };

  // ── 根据 run 状态决定渲染的操作区 ──────────────────────────────────────
  const renderActions = (r: AgentRun) => {
    switch (r.status) {
      case "review":
        return (
          <div className="flex gap-2">
            {/* no_change 时禁用合并并加提示 */}
            <Button
              size="sm"
              onClick={() => void handleMerge()}
              disabled={acting || r.no_change}
              title={r.no_change ? "Agent 未产生任何文件变更，无需合并" : "将 Agent 结果合并进主分支"}
            >
              合并
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleDiscard()}
              disabled={acting}
            >
              打回
            </Button>
            {/* no_change 提示行 */}
            {r.no_change && (
              <span className="self-center text-xs text-muted-foreground">
                无文件变更
              </span>
            )}
          </div>
        );
      case "blocked":
        return (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleDiscard()}
              disabled={acting}
            >
              打回
            </Button>
            <Button
              size="sm"
              onClick={() => void handleRedispatch()}
              disabled={acting}
            >
              重派
            </Button>
          </div>
        );
      case "running":
        // 执行中：实时渲染 liveLog；liveLog 为空时显示等待提示
        return liveLog ? (
          <pre
            ref={liveLogRef}
            className="min-h-0 max-h-64 flex-1 overflow-y-auto rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-all"
          >
            {liveLog}
          </pre>
        ) : (
          <span className="text-xs text-muted-foreground">执行中，等待输出…</span>
        );
      default:
        // merged / discarded：终态，无额外操作
        return null;
    }
  };

  const badge = run ? RUN_STATUS_BADGE[run.status] : null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="flex w-[480px] max-w-full flex-col gap-0 sm:max-w-[520px]">
        <SheetHeader className="shrink-0 border-b pb-4">
          <SheetTitle className="text-base">Agent 运行详情</SheetTitle>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4">
          {/* 加载态 */}
          {loading && (
            <p className="text-sm text-muted-foreground">加载中…</p>
          )}

          {/* 无 run */}
          {!loading && !run && (
            <p className="text-sm text-muted-foreground">该任务暂无 Agent 执行记录。</p>
          )}

          {/* run 详情 */}
          {!loading && run && (
            <>
              {/* 基础信息行 */}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {/* Provider */}
                <span className="font-medium">{providerLabel(run.provider)}</span>

                {/* 状态徽标 */}
                {badge && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      badge.cls,
                    )}
                  >
                    {badge.label}
                  </span>
                )}

                {/* 开始时间 */}
                {run.started && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(run.started).toLocaleString()}
                  </span>
                )}
              </div>

              {/* diff_stat（有变更时显示） */}
              {run.diff_stat && (
                <section>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    变更摘要
                  </p>
                  <pre className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-all">
                    {run.diff_stat}
                  </pre>
                </section>
              )}

              {/* blocker（受阻原因） */}
              {run.status === "blocked" && run.blocker && (
                <section>
                  <p className="mb-1 text-xs font-semibold text-destructive uppercase tracking-wide">
                    受阻原因
                  </p>
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {run.blocker}
                  </p>
                </section>
              )}

              {/* log_tail（执行日志尾段） */}
              {run.log_tail && (
                <section className="flex min-h-0 flex-1 flex-col">
                  <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    执行日志
                  </p>
                  <pre className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-all">
                    {run.log_tail}
                  </pre>
                </section>
              )}

              {/* 操作区 */}
              <div className="shrink-0 border-t pt-4">
                {renderActions(run)}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
