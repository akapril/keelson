// Claude Code 集成（一键）（从 pages/settings.tsx 拆出，逻辑逐字保留）。
// 一次装/卸 rework 的两条 hook：① 活动 hook(PostToolUse *) 上报活动流+看板同步；
// ② 拦截 hook(PreToolUse Bash) 长驻进程自动托管。只增删自己那两条，其它逐字保留。
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";

export function ClaudeIntegrationSection() {
  const [activity, setActivity] = useState<{ installed: boolean; up_to_date: boolean } | null>(null);
  const [intercept, setIntercept] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void ipc.activityHookStatus().then(setActivity).catch(() => setActivity(null));
    void ipc.interceptHookStatus().then(setIntercept).catch(() => setIntercept(false));
  };
  useEffect(refresh, []);

  // 一键启用/升级：幂等装全部 hook（就地替换成当前版本命令）
  const enable = async (isUpgrade: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await Promise.all([ipc.installActivityHook(), ipc.installInterceptHook()]);
      toast.success(
        isUpgrade
          ? "已升级到最新（需重启 Claude 会话生效）"
          : "已启用 Claude Code 集成：工具流上报 + 长驻进程自动托管（需重启会话生效）",
      );
      refresh();
    } catch (e) {
      toast.error(`操作失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await Promise.all([ipc.uninstallActivityHook(), ipc.uninstallInterceptHook()]);
      toast.success("已停用 Claude Code 集成");
      refresh();
    } catch (e) {
      toast.error(`操作失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const loading = activity === null || intercept === null;
  const enabled = (activity?.installed ?? false) && intercept === true;
  // 活动 hook 带版本；已启用但活动 hook 过期 → 提示升级（升级会重装全部到最新）
  const stale = enabled && !(activity?.up_to_date ?? true);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Claude Code 集成</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          一键启用 Keelson 与 Claude Code 的联动：① 每次工具操作实时上报<strong>活动流</strong>（看板同步依赖它）；
          ② Claude 起 <code className="rounded bg-muted px-1">npm run dev</code> 等长驻进程时<strong>自动托管</strong>进「进程」页。
          只增删 Keelson 自己那两条 hook，其它设置逐字保留。需重启 Claude 会话生效。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {loading ? (
          <span className="text-xs text-muted-foreground">读取状态中…</span>
        ) : stale ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            已启用（有更新，建议升级）
          </span>
        ) : enabled ? (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
            已启用（最新）
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">未启用</span>
        )}

        {stale && (
          <Button variant="default" size="sm" disabled={busy} onClick={() => void enable(true)}>
            {busy ? "处理中…" : "一键升级"}
          </Button>
        )}
        <Button
          variant={enabled ? "outline" : "default"}
          size="sm"
          disabled={loading || busy}
          onClick={() => void (enabled ? disable() : enable(false))}
        >
          {busy ? "处理中…" : enabled ? "停用" : "一键启用"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        说明：Codex 无逐工具 hook，仅通过 MCP（上方）上报看板/文档操作；实时全量工具流与进程拦截仅 Claude Code 支持。
      </p>
    </section>
  );
}
