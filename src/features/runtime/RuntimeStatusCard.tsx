// 「本地运行时」状态卡：健康/时长 · 机器资源(CPU/内存) · agent 容量 · 磁盘。
// 每 3s 轮询 ipc.runtimeStatus；轮询失败静默（显 "—" 占位，不 toast 轰炸）。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/tauri/ipc";
import type { RuntimeStatus } from "@/types/runtime";
import { formatUptime, capacityLabel, memBarPercent } from "./runtime-format";
import { cn } from "@/lib/utils";

// 轮询间隔（CPU 是活值，需要定期刷新）
const POLL_MS = 3000;

export function RuntimeStatusCard() {
  const { t } = useTranslation("shell");
  const [status, setStatus] = useState<RuntimeStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () => {
      ipc
        .runtimeStatus()
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {
          /* 轮询失败静默：保留上次值/占位，不打断用户 */
        });
    };
    fetchOnce();
    const timer = setInterval(fetchOnce, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // 占位符：数据未到时显 "—"
  const dash = "—";
  const capFull = !!status && status.agent_running >= status.agent_cap;

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:grid-cols-4">
      {/* 健康 / 运行时长 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("runtime.card.health")}</span>
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className={cn("size-2 rounded-full", status?.pb_ok ? "bg-emerald-500" : "bg-amber-500")} />
          {t("runtime.card.running")}
        </span>
        <span className="text-xs text-muted-foreground">
          {status ? formatUptime(status.uptime_secs) : dash}
        </span>
      </div>

      {/* 机器资源 CPU / 内存 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("runtime.card.resources")}</span>
        <span className="text-sm font-medium">
          CPU {status ? `${Math.round(status.cpu_percent)}%` : dash}
        </span>
        <div className="mt-0.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${status ? memBarPercent(status.mem_used, status.mem_total) : 0}%` }}
            />
          </div>
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            {status ? status.mem_display : dash}
          </span>
        </div>
      </div>

      {/* agent 容量 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("runtime.card.agentCapacity")}</span>
        <span className={cn("text-sm font-medium", capFull && "text-destructive")}>
          {status ? capacityLabel(status.agent_running, status.agent_cap) : dash}
        </span>
        {capFull && (
          <span className="text-[10px] text-destructive">{t("runtime.card.capFull")}</span>
        )}
      </div>

      {/* 磁盘占用 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("runtime.card.disk")}</span>
        <span className="text-sm font-medium">{status ? status.disk_display : dash}</span>
        <span className="text-[10px] text-muted-foreground">{t("runtime.card.diskHint")}</span>
      </div>
    </div>
  );
}
