// 系统与数据设置：开机自启 + PocketBase 存储占用 / 日志保留天数 / 清空日志（回收磁盘）。
// 桌面专属（用 Tauri 命令）；web 端不渲染。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ipc } from "@/lib/tauri/ipc";
import { isTauri } from "@/lib/env";

interface Storage {
  pb_data_bytes: number;
  logs_bytes: number;
  data_bytes: number;
  retention_days: number;
}

/** 字节 → 人类可读。 */
function fmtBytes(n: number): string {
  if (!n) return "—";
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(0)} KB`;
  return `${n} B`;
}

export function SystemDataSection() {
  const { t } = useTranslation("settings");
  const [autostart, setAutostart] = useState(false);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    void ipc.autostartGet().then(setAutostart).catch(() => {});
    void ipc.pbStorageInfo().then((s) => {
      setStorage(s);
      setDays(s.retention_days);
    }).catch(() => {});
  }, []);

  // web 端不提供这些（Tauri 命令），直接不渲染
  if (!isTauri()) return null;

  const toggleAutostart = async (next: boolean) => {
    setAutostart(next); // 乐观
    try {
      await ipc.autostartSet(next);
    } catch (e) {
      setAutostart(!next); // 回滚
      toast.error(t("systemData.error", { msg: String(e) }));
    }
  };

  const applyDays = async () => {
    const d = Math.min(365, Math.max(1, Math.round(days) || 7));
    setDays(d);
    try {
      await ipc.setLogRetention(d);
      toast.success(t("systemData.retentionSaved"));
    } catch (e) {
      toast.error(t("systemData.error", { msg: String(e) }));
    }
  };

  const clearLogs = async () => {
    setBusy(true);
    try {
      await ipc.clearPbLogs();
      toast.success(t("systemData.clearQueued"));
    } catch (e) {
      toast.error(t("systemData.error", { msg: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">{t("systemData.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("systemData.desc")}</p>
      </div>

      {/* 开机自启 */}
      <label htmlFor="system-autostart" className="flex cursor-pointer items-center gap-2 text-sm select-none">
        <Checkbox
          id="system-autostart"
          checked={autostart}
          onCheckedChange={(v) => void toggleAutostart(v === true)}
          className="cursor-pointer"
        />
        <span>{t("systemData.autostartLabel")}</span>
      </label>

      {/* 存储占用 */}
      <div className="space-y-1 rounded-lg border border-border bg-card p-3 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("systemData.pbTotal")}</span>
          <span className="tabular-nums">{fmtBytes(storage?.pb_data_bytes ?? 0)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("systemData.dataDb")}</span>
          <span className="tabular-nums">{fmtBytes(storage?.data_bytes ?? 0)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("systemData.logsDb")}</span>
          <span className="tabular-nums">{fmtBytes(storage?.logs_bytes ?? 0)}</span>
        </div>
      </div>

      {/* 日志保留天数（下次启动生效） */}
      <div className="flex items-end gap-2">
        <label className="flex-1 space-y-1">
          <span className="text-xs text-muted-foreground">{t("systemData.retentionLabel")}</span>
          <Input
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-8"
          />
        </label>
        <Button type="button" variant="outline" size="sm" onClick={() => void applyDays()}>
          {t("systemData.retentionSave")}
        </Button>
      </div>

      {/* 清空日志（回收磁盘，下次启动生效） */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t("systemData.clearHint")}</span>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void clearLogs()}>
          {t("systemData.clearBtn")}
        </Button>
      </div>
    </section>
  );
}
