// Claude Code 集成（一键）（从 pages/settings.tsx 拆出，逻辑逐字保留）。
// 一次装/卸 rework 的两条 hook：① 活动 hook(PostToolUse *) 上报活动流+看板同步；
// ② 拦截 hook(PreToolUse Bash) 长驻进程自动托管。只增删自己那两条，其它逐字保留。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";

export function ClaudeIntegrationSection() {
  const { t } = useTranslation("settings");
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
          ? t("claudeIntegration.upgradeSuccess")
          : t("claudeIntegration.enableSuccess"),
      );
      refresh();
    } catch (e) {
      toast.error(t("claudeIntegration.actionError", { message: String(e) }));
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await Promise.all([ipc.uninstallActivityHook(), ipc.uninstallInterceptHook()]);
      toast.success(t("claudeIntegration.disableSuccess"));
      refresh();
    } catch (e) {
      toast.error(t("claudeIntegration.actionError", { message: String(e) }));
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
        <h2 className="text-sm font-medium">{t("claudeIntegration.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("claudeIntegration.desc")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {loading ? (
          <span className="text-xs text-muted-foreground">{t("claudeIntegration.loading")}</span>
        ) : stale ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            {t("claudeIntegration.statusStale")}
          </span>
        ) : enabled ? (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
            {t("claudeIntegration.statusEnabled")}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t("claudeIntegration.statusDisabled")}</span>
        )}

        {stale && (
          <Button variant="default" size="sm" disabled={busy} onClick={() => void enable(true)}>
            {busy ? t("claudeIntegration.processing") : t("claudeIntegration.upgradeBtn")}
          </Button>
        )}
        <Button
          variant={enabled ? "outline" : "default"}
          size="sm"
          disabled={loading || busy}
          onClick={() => void (enabled ? disable() : enable(false))}
        >
          {busy
            ? t("claudeIntegration.processing")
            : enabled
              ? t("claudeIntegration.disableBtn")
              : t("claudeIntegration.enableBtn")}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("claudeIntegration.hint")}
      </p>
    </section>
  );
}
