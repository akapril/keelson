// agent run 决策动作（合并/打回/重派）单一真源：AgentRunPanel 与 Agent 待办行共用，避免逻辑两处漂移。
import { useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";
import { providerLabel } from "@/lib/providers";
import type { AgentRun } from "@/types/agent";

/**
 * 重派时的可选上下文，供调用方注入日志重置/增量回调及显示名称。
 * AgentRunPanel 使用这些钩子保持实时日志功能；轻量调用方（待办行）可省略。
 */
export interface RedispatchOptions {
  /** 重派前清空旧日志（如面板的 useAgentLogStore reset） */
  onReset?: () => void;
  /** 接收流式增量文本（如面板的 useAgentLogStore append） */
  onDelta?: (text: string) => void;
  /** 覆盖显示名称（如面板从 agents store 查到的 emoji+name 字符串） */
  displayName?: string;
}

export function useAgentRunActions(onDone?: () => void) {
  const [busy, setBusy] = useState(false);

  /** 合并 run（review 态）：agentMergeRun → 按结果分流（成功 toast / 冲突给可操作出口）→ onDone */
  const merge = async (run: AgentRun) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await ipc.agentMergeRun(run.id);
      // 自动 stash 的改动 pop 失败：无论成功/冲突都单独警告一次（改动仍安全在 stash 里）
      if (res.warning) toast.warning(res.warning, { duration: 10000 });

      if (res.kind === "conflict") {
        // 真冲突不是故障：已安全回滚、未动主干。给一条可操作出路而非甩「请手动处理」。
        const shown = res.files.slice(0, 6).join("、");
        const fileHint = res.files.length
          ? `${shown}${res.files.length > 6 ? ` 等 ${res.files.length} 个文件` : ""}`
          : "若干文件";
        // 解决办法：进隔离 worktree rebase 到 base、解决后回来重点合并（主干全程未动）
        const steps = res.base
          ? `进入 worktree 执行 git rebase ${res.base}，解决冲突后回来重新点合并`
          : "进入 worktree 解决冲突后回来重新点合并";
        toast.error(`与主分支冲突：${fileHint}`, {
          description: `已安全回滚、未改动主分支。agent 分支 ${res.branch ?? ""} 已保留。${steps}。`,
          duration: 14000,
          action: res.worktree
            ? {
                label: "打开 worktree 目录",
                onClick: () => void ipc.openPath(res.worktree as string),
              }
            : undefined,
        });
        // 不 onDone：run 保持 review 态，让用户解决后重试合并
        return;
      }

      // 合并成功：带 merge commit 短 sha + 回退提示（动了主干该有反悔余地，git-native 用户拿 sha 即可 revert）
      const sha = res.sha;
      toast.success(
        sha ? `已合并进主分支（${sha}）` : "已将 Agent 结果合并进主分支",
        sha ? { description: `如需回退：git revert -m 1 ${sha}`, duration: 8000 } : undefined,
      );
      onDone?.();
    } catch (e) {
      toast.error(`合并失败：${String(e)}`);
      // 重抛，确保调用方 catch 能感知（不吞错）
      throw e;
    } finally {
      setBusy(false);
    }
  };

  /** 打回 run（review / blocked 态）：agentDiscardRun → toast → onDone */
  const discard = async (run: AgentRun) => {
    if (busy) return;
    setBusy(true);
    try {
      await ipc.agentDiscardRun(run.id);
      toast.success("已打回此次 Agent 运行");
      onDone?.();
    } catch (e) {
      toast.error(`打回失败：${String(e)}`);
      throw e;
    } finally {
      setBusy(false);
    }
  };

  /**
   * 重派（blocked 态）：先打回旧 run 清理 worktree，再触发流式执行。
   * - ropts.onReset：在新执行发起前清空日志 store。
   * - ropts.onDelta：接收流式增量文本写入日志 store。
   * - ropts.displayName：toast 里显示的队友名；省略时用 providerLabel(run.provider)。
   * - agentRunTask 是流式 fire-and-forget，触发后立即释放 busy，面板关闭后增量仍可写入 store。
   */
  const redispatch = async (run: AgentRun, ropts?: RedispatchOptions) => {
    if (busy) return;
    setBusy(true);
    // S2 末审：用 || 而非 ??，空字符串 run.agent 须回退到 provider（?? 会保留空串导致 resolve 失败）
    const agentRef = run.agent || run.provider;
    const name = ropts?.displayName ?? providerLabel(run.provider);
    try {
      // 先打回当前 blocked run，清理 worktree
      await ipc.agentDiscardRun(run.id);
      // 调用方清空旧日志（面板用于重置实时日志区）
      ropts?.onReset?.();
      // 触发流式执行，不 await 完整流
      void ipc.agentRunTask(run.task, agentRef, (e) => {
        if (e.kind === "delta" && e.text) {
          // 增量文本写入调用方日志 store
          ropts?.onDelta?.(e.text);
        } else if (e.kind === "done") {
          toast.success(`${name} 重派完成`);
          onDone?.();
        }
      });
      toast.message(`已重派给 ${name}，执行中…`);
    } catch (e) {
      toast.error(`重派失败：${String(e)}`);
      throw e;
    } finally {
      // 流式触发后即可释放 busy（执行异步进行，面板已关闭也无副作用）
      setBusy(false);
    }
  };

  return { busy, merge, discard, redispatch };
}
