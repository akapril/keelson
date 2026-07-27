// 活动指示器 —— 顶栏全局实时指示：有新活动脉冲 + 下拉看内存流最近 N 条（点跳对应项目）。
// 仿 notification-bell：只呈现内存流（实时、重启即清）；持久历史在项目工作台「活动」tab。
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Activity03Icon,
  Edit02Icon,
  BookOpen01Icon,
  TerminalIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useActivityStore } from "@/store/activity";
import type { ActivityAction, ActivityEvent } from "@/types/activity";

// 下拉最多显示的最近活动条数
const SHOW_N = 12;

// 动作 → 图标（中性语义，不硬编码颜色）
const ACTION_ICON: Record<ActivityAction, typeof Edit02Icon> = {
  write: Edit02Icon,
  read: BookOpen01Icon,
  run: TerminalIcon,
  search: Search01Icon,
};

// 简短相对时间（接受 t 函数）
function makeShortTime(t: (key: string, opts?: Record<string, unknown>) => string) {
  return (iso: string): string => {
    if (!iso) return "";
    const d = new Date(iso).getTime();
    if (Number.isNaN(d)) return "";
    const diff = Math.max(0, Date.now() - d);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return t("activity.timeJustNow");
    const min = Math.floor(sec / 60);
    if (min < 60) return t("activity.timeMinutesAgo", { n: min });
    const hr = Math.floor(min / 60);
    if (hr < 24) return t("activity.timeHoursAgo", { n: hr });
    return new Date(iso).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  };
}

export function ActivityIndicator() {
  const { t } = useTranslation("shell");
  const shortTime = makeShortTime(t);
  const navigate = useNavigate();
  const events = useActivityStore((s) => s.events);
  const pulse = useActivityStore((s) => s.pulse);

  // 脉冲：pulse 时间戳变化时短暂高亮图标（新活动到达提示）
  const [pulsing, setPulsing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!pulse) return;
    setPulsing(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPulsing(false), 1200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [pulse]);

  const onItemClick = (ev: ActivityEvent) => {
    // 有关联项目则跳到该项目「活动」tab；否则不导航
    if (ev.project_id) {
      navigate(`/board?open=${ev.project_id}&tab=activity`);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("activity.ariaLabel")}>
          <HugeiconsIcon
            icon={Activity03Icon}
            strokeWidth={2}
            className={cn("transition-colors", pulsing && "text-primary")}
          />
          {/* 有新活动脉冲：右上角小圆点动画 */}
          {pulsing && (
            <span className="absolute right-1 top-1 flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">{t("activity.title")}</span>
          <button
            type="button"
            onClick={() => useActivityStore.getState().clear()}
            disabled={events.length === 0}
            className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            {t("activity.clearAll")}
          </button>
        </div>

        {/* 列表 */}
        <div className="max-h-96 overflow-y-auto">
          {events.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <HugeiconsIcon icon={Activity03Icon} strokeWidth={1.5} className="size-8 opacity-50" />
              <span className="text-xs">{t("activity.empty")}</span>
            </div>
          ) : (
            events.slice(0, SHOW_N).map((ev) => {
              const Icon = ACTION_ICON[ev.action] ?? BookOpen01Icon;
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => onItemClick(ev)}
                  className={cn(
                    "flex w-full gap-2 border-b border-border/60 px-3 py-2.5 text-left text-sm last:border-0 hover:bg-accent",
                    ev.project_id ? "cursor-pointer" : "cursor-default",
                  )}
                >
                  <HugeiconsIcon
                    icon={Icon}
                    strokeWidth={2}
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      ev.status === "error" ? "text-destructive" : "text-muted-foreground",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">{ev.summary}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="rounded bg-muted px-1">{ev.tool}</span>
                      {ev.status === "error" && (
                        <span className="text-destructive">{t("activity.statusError")}</span>
                      )}
                      <span>{shortTime(ev.ts)}</span>
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
