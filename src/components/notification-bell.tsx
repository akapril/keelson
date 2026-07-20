// 通知铃铛 —— 头部入口：未读红标 + 下拉通知面板（标记已读 / 跳转 / 删除 / 清空）。
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Notification03Icon,
  Delete02Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useNotificationsStore } from "@/store/notifications";
import { syncDueReminders } from "@/features/notifications/due-reminders";
import { syncNewSessionsReminder } from "@/features/notifications/new-sessions";
import type { AppNotification, NotificationKind } from "@/types/notifications";

// 类别 → 色点
const KIND_DOT: Record<NotificationKind, string> = {
  info: "bg-muted-foreground/50",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

// 简短相对时间
function shortTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - d);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function NotificationBell() {
  const navigate = useNavigate();
  const items = useNotificationsStore((s) => s.items);
  const unread = useNotificationsStore((s) => s.items.filter((n) => !n.read).length);

  // 挂载时加载 + 订阅（store 内部保证仅订阅一次），随后扫描到期项生成截止提醒（一次/会话）
  useEffect(() => {
    void useNotificationsStore
      .getState()
      .load()
      .then(() => {
        void syncDueReminders();
        void syncNewSessionsReminder();
      });
  }, []);

  const onItemClick = (n: AppNotification) => {
    if (!n.read) void useNotificationsStore.getState().markRead(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="通知">
          <HugeiconsIcon icon={Notification03Icon} strokeWidth={2} />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold leading-none text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">
            通知{unread > 0 ? ` · ${unread} 未读` : ""}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void useNotificationsStore.getState().markAllRead()}
              disabled={unread === 0}
              className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              全部已读
            </button>
            <button
              type="button"
              onClick={() => void useNotificationsStore.getState().clearAll()}
              disabled={items.length === 0}
              className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-40"
            >
              清空
            </button>
          </div>
        </div>

        {/* 列表 */}
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.5} className="size-8 opacity-50" />
              <span className="text-xs">暂无通知</span>
            </div>
          ) : (
            items.slice(0, 8).map((n) => (
              <div
                key={n.id}
                className={cn(
                  "group flex gap-2 border-b border-border/60 px-3 py-2.5 text-sm last:border-0",
                  !n.read && "bg-primary/[0.04]",
                )}
              >
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", KIND_DOT[n.kind])} />
                <button
                  type="button"
                  onClick={() => onItemClick(n)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-1.5">
                    <span className={cn("truncate", n.read ? "text-foreground/80" : "font-medium text-foreground")}>
                      {n.title}
                    </span>
                  </div>
                  {n.body && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                  )}
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                    {n.source && <span className="rounded bg-muted px-1">{n.source}</span>}
                    <span>{shortTime(n.created)}</span>
                  </div>
                </button>
                <button
                  type="button"
                  aria-label="删除"
                  onClick={() => void useNotificationsStore.getState().remove(n.id)}
                  className="shrink-0 self-start rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* 底部：查看全部（收件箱可批处理/过滤/分组） */}
        <button
          type="button"
          onClick={() => navigate("/inbox")}
          className="w-full border-t border-border px-3 py-2 text-center text-xs text-primary hover:bg-accent"
        >
          查看全部（收件箱）{items.length > 8 ? ` · 共 ${items.length}` : ""} →
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
