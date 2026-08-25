// AgentRunPanel —— Agent 运行详情面板（Sheet 形式；显示日志/diff/状态操作）。
// 打开时拉最新 run → 按状态渲染操作按钮；操作成功 toast + 刷新；失败重抛 + toast。
import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";
import { providerLabel } from "@/lib/providers";
import { listAgentRuns } from "@/lib/pb/agent-runs";
import type { AgentRun, AgentRunStatus } from "@/types/agent";
import { useAgentLogStore } from "@/store/agent-run-logs";
import { useAgentStore } from "@/store/agents";
import { useAgentRunActions } from "./useAgentRunActions";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { statusTone } from "@/lib/status-tone";
import { cn } from "@/lib/utils";

// ── 状态徽标样式映射（走 statusTone 单一色调，与看板卡片状态徽标同源，不再内联色）───────
const RUN_STATUS_BADGE: Record<AgentRunStatus, { label: string; cls: string }> = {
  running: { label: "执行中", cls: statusTone("info").chip },
  review:  { label: "待审",   cls: statusTone("warning").chip },
  blocked: { label: "受阻",   cls: statusTone("danger").chip },
  merged:  { label: "已合并", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  discarded: { label: "已打回", cls: statusTone("neutral").chip },
};

/** 已耗时格式化：秒级差 → "Xm Ys" / "Ys"（供 running run 计时展示）。 */
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

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
 * - running → 「执行日志」区实时渲染 liveLog（订阅 agent-run-logs store）；
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
  // 实时日志：订阅 agent-run-logs store，执行中边跑边渲染
  const liveLog = useAgentLogStore((s) => s.logs[taskId] ?? "");
  // S2：从 run.agent 反查命名队友（找不到则回退 providerLabel）
  const agents = useAgentStore((s) => s.agents);
  // 日志区 ref，用于 liveLog 变化时自动滚到底部
  const liveLogRef = useRef<HTMLPreElement>(null);
  // 审阅材料：按需只读拉取完整改动 patch（合并/打回前先看清改了什么，不再盲签）
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // 拉取并展开某 run 的改动 patch（切换：已展开则收起）
  const loadDiff = useCallback(async (runId: string) => {
    if (diff !== null) {
      setDiff(null);
      return;
    }
    setDiffLoading(true);
    try {
      setDiff(await ipc.agentRunDiff(runId));
    } catch (e) {
      toast.error(`读取改动失败：${String(e)}`);
    } finally {
      setDiffLoading(false);
    }
  }, [diff]);

  // 停止运行中的 agent（发中止信号，后端协作式中断 + 杀子进程）
  const [stopping, setStopping] = useState(false);
  const stop = useCallback(
    async (runId: string) => {
      setStopping(true);
      try {
        await ipc.agentStop(runId);
        toast.success("已发送停止信号");
        onRefresh?.();
      } catch (e) {
        toast.error(`停止失败：${String(e)}`);
      } finally {
        setStopping(false);
      }
    },
    [onRefresh],
  );

  // running 态每秒滴答，用于「已执行 Xm Ys」计时——打消「卡了没」的疑虑，是在途可见性的一环
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (run?.status !== "running") return;
    setNowTs(Date.now());
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [run?.status]);

  // 决策动作 hook（合并/打回/重派）：成功后刷新徽标并关闭面板
  const { busy, merge, discard, redispatch } = useAgentRunActions(() => {
    onRefresh?.();
    onClose();
  });

  // 日志变化时自动将日志区滚到底部（实时 liveLog 与完成后的 log_tail 都触发）
  useEffect(() => {
    const el = liveLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveLog, run?.log_tail]);

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
      setDiff(null); // 一并清掉已展开的改动，避免下次打开显示上个 run 的 patch
    }
  }, [open, refresh]);

  // ── 根据 run 状态决定渲染的操作区 ──────────────────────────────────────
  const renderActions = (r: AgentRun) => {
    switch (r.status) {
      case "review":
        return (
          <div className="flex gap-2">
            {/* no_change 时禁用合并并加提示 */}
            <Button
              size="sm"
              onClick={() => void merge(r)}
              disabled={busy || r.no_change}
              title={r.no_change ? "Agent 未产生任何文件变更，无需合并" : "将 Agent 结果合并进主分支"}
            >
              合并
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void discard(r)}
              disabled={busy}
            >
              打回
            </Button>
            {/* 查看改动：合并/打回前先看清 patch，不再盲签 */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadDiff(r.id)}
              disabled={diffLoading}
            >
              {diffLoading ? "读取中…" : diff !== null ? "隐藏改动" : "查看改动"}
            </Button>
            {/* no_change 提示行 */}
            {r.no_change && (
              <span className="self-center text-xs text-muted-foreground">
                无文件变更
              </span>
            )}
          </div>
        );
      case "blocked": {
        // S2：计算命名队友显示名（emoji+name 或 providerLabel），传给 hook 的 redispatch
        const agentProfile = r.agent
          ? agents.find((a) => a.id === r.agent) ?? null
          : null;
        const displayName = agentProfile
          ? `${agentProfile.emoji ? `${agentProfile.emoji} ` : ""}${agentProfile.name}`
          : providerLabel(r.provider);
        return (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void discard(r)}
              disabled={busy}
            >
              打回
            </Button>
            {/* 受阻 run 可能有半成品改动，打回/重派前也能看清 */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadDiff(r.id)}
              disabled={diffLoading}
            >
              {diffLoading ? "读取中…" : diff !== null ? "隐藏改动" : "查看改动"}
            </Button>
            <Button
              size="sm"
              onClick={() =>
                void redispatch(r, {
                  // 发起前清空旧日志，让实时日志区从头开始
                  onReset: () => useAgentLogStore.getState().reset(taskId),
                  // 增量文本写入 store，面板实时渲染（面板关闭后写入无副作用）
                  onDelta: (text) => useAgentLogStore.getState().append(taskId, text),
                  // 优先使用命名队友 emoji+name，确保 toast 显示与面板标题一致
                  displayName,
                })
              }
              disabled={busy}
            >
              重派
            </Button>
          </div>
        );
      }
      case "running":
        // 执行中：给「停止」按钮（发中止信号）；日志由下方统一「执行日志」区实时展示
        return (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void stop(r.id)}
              disabled={stopping}
            >
              {stopping ? "停止中…" : "停止"}
            </Button>
          </div>
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
              {/* 头部：队友名(突出) + 状态徽标 一行；下面一行元信息(开始时间 · 已耗时) */}
              {(() => {
                const agentProfile = run.agent
                  ? agents.find((a) => a.id === run.agent) ?? null
                  : null;
                const name = agentProfile
                  ? `${agentProfile.emoji ? `${agentProfile.emoji} ` : ""}${agentProfile.name}`
                  : providerLabel(run.provider);
                return (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{name}</span>
                      {badge && (
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", badge.cls)}>
                          {badge.label}
                        </span>
                      )}
                    </div>
                    {run.started && (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{new Date(run.started).toLocaleString()}</span>
                        {run.status === "running" && (
                          <span className="tabular-nums">· 已执行 {fmtElapsed(nowTs - Date.parse(run.started))}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

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

              {/* 完整改动 patch（点「查看改动」按需展开；含 agent 自提交 + 未提交 + 未跟踪） */}
              {diff !== null && (
                <section>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    完整改动
                  </p>
                  <pre className="max-h-96 overflow-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
                    {diff}
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

              {/* 执行日志（running=实时 liveLog；其它状态=已落 log_tail），终端风格 */}
              {(() => {
                const isLive = run.status === "running";
                const logText = isLive ? liveLog : run.log_tail;
                if (!logText && !isLive) return null;
                return (
                  <section className="flex min-h-0 flex-1 flex-col">
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        执行日志
                        {isLive && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium normal-case text-blue-600 dark:text-blue-400">
                            <span className="size-1.5 animate-pulse rounded-full bg-blue-500" />
                            实时
                          </span>
                        )}
                      </p>
                      {logText && (
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(logText);
                            toast.success("日志已复制");
                          }}
                          className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          复制
                        </button>
                      )}
                    </div>
                    <pre
                      ref={liveLogRef}
                      className="min-h-[9rem] flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-zinc-950 px-3 py-2.5 font-mono text-xs leading-relaxed text-zinc-100 dark:bg-black"
                    >
                      {logText || "执行中，等待输出…"}
                    </pre>
                  </section>
                );
              })()}

              {/* 操作区（终态/执行中无按钮时不渲染空框） */}
              {renderActions(run) && (
                <div className="shrink-0 border-t pt-4">{renderActions(run)}</div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
