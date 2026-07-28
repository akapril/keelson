// web/panels/Notifications.tsx — 通知栏（Task 9）
// 职责：经 /pb 反代读 PB notifications 集合，只读列表渲染（未读高亮）。
// 移动优先布局；三态（加载中/空态/错误）；按时间倒序；不硬编色。
// ⚠️ 只读：web 端无写权限，仅展示。

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { listNotifications } from "@/lib/pb/notifications";
import type { AppNotification, NotificationKind } from "@/types/notifications";

// 类别 → 色点（与桌面 inbox/notification-bell 保持一致）
const KIND_DOT: Record<NotificationKind, string> = {
  info: "bg-muted-foreground/50",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

/** 简短相对时间（分/时/天前，超 7 天显示 MM-DD）。 */
function relativeTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const diff = Math.max(0, Date.now() - d);
  const min = 60_000, hour = 3_600_000, day = 86_400_000;
  if (diff < min) return "just now";
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  const pad = (n: number) => String(n).padStart(2, "0");
  const dt = new Date(d);
  return `${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// ── 骨架屏 ────────────────────────────────────────────────────

function NotificationSkeleton() {
  return (
    <div
      className="flex gap-3 rounded-lg border border-border bg-card p-3"
      aria-hidden
    >
      <div className="mt-1.5 size-1.5 shrink-0 animate-pulse rounded-full bg-muted" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-3 w-full animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-20 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

// ── 单条通知卡片（只读）────────────────────────────────────────

interface NotificationCardProps {
  item: AppNotification;
}

function NotificationCard({ item }: NotificationCardProps) {
  const when = relativeTime(item.created);

  return (
    <div
      className={`flex gap-3 rounded-lg border bg-card p-3 transition-colors ${
        item.read
          ? "border-border"
          : "border-primary/20 bg-primary/[0.04]"
      }`}
      role="listitem"
      aria-label={item.title}
    >
      {/* 色点：类别指示器 */}
      <span
        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${KIND_DOT[item.kind]}`}
        aria-hidden
      />

      {/* 内容区 */}
      <div className="min-w-0 flex-1">
        {/* 标题行：未读加粗 */}
        <p
          className={`truncate text-sm ${
            item.read
              ? "text-foreground/80"
              : "font-medium text-foreground"
          }`}
        >
          {item.title}
        </p>

        {/* 正文：最多 3 行 */}
        {item.body && (
          <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">
            {item.body}
          </p>
        )}

        {/* 元信息：来源 + 时间 */}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          {item.source && (
            <span className="rounded bg-muted px-1 py-px">{item.source}</span>
          )}
          {when && <span>{when}</span>}
          {/* 未读指示文字（辅助技术感知） */}
          {!item.read && (
            <span className="sr-only">unread</span>
          )}
        </div>
      </div>

      {/* 未读圆点（右侧视觉强调） */}
      {!item.read && (
        <span
          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
          aria-hidden
        />
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────

export interface NotificationsProps {
  /**
   * PB 初始化是否完成（由 MainLayout 传入）。
   * false 时展示加载态，避免 PB 未认证时提前请求返回 401。
   */
  pbReady: boolean;
}

/**
 * 通知栏（Task 9）：经 /pb 反代读 PB notifications 集合，只读列表。
 * - 只读：web 端不支持标记已读/删除（不授权写操作）。
 * - 三态：加载中 / 空态 / 错误（toast）。
 * - 按时间倒序（PB 查询已 sort=-created）。
 * - 移动优先，无硬编色，WCAG 2.1 AA 键盘可访问。
 */
export function Notifications({ pbReady }: NotificationsProps) {
  const { t } = useTranslation("web");

  type LoadState = "loading" | "empty" | "loaded" | "error";
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [items, setItems] = useState<AppNotification[]>([]);

  useEffect(() => {
    // PB 未就绪：保持 loading 态，等 pbReady 变为 true 再请求
    if (!pbReady) return;

    let cancelled = false;
    setLoadState("loading");

    listNotifications()
      .then((data) => {
        if (cancelled) return;
        setItems(data);
        setLoadState(data.length === 0 ? "empty" : "loaded");
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[Notifications] 加载通知失败:", err);
        toast.error(t("notifications.errorHint"));
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [pbReady, t]);

  // 未读计数（标题行徽章）
  const unreadCount = items.filter((n) => !n.read).length;

  return (
    <div className="flex h-full flex-col">
      {/* 标题行 */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            {t("notifications.title")}
          </h2>
          {unreadCount > 0 && (
            <span
              className="flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
              aria-label={t("notifications.unreadBadgeLabel", { count: unreadCount })}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
        {/* 副标题：只读说明 */}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("notifications.subtitle")}
        </p>
      </div>

      {/* 内容区：可滚动列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* 加载态：骨架屏 */}
        {loadState === "loading" && (
          <div
            className="flex flex-col gap-2"
            role="status"
            aria-label={t("notifications.loading")}
          >
            <NotificationSkeleton />
            <NotificationSkeleton />
            <NotificationSkeleton />
          </div>
        )}

        {/* 空态 */}
        {loadState === "empty" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
            {/* 纯 SVG 铃铛图标，无额外依赖 */}
            <svg
              className="size-10 text-muted-foreground/40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <p className="text-sm text-muted-foreground">{t("notifications.empty")}</p>
          </div>
        )}

        {/* 错误态 */}
        {loadState === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm font-medium text-foreground">
              {t("notifications.errorHint")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("notifications.errorSubtitle")}
            </p>
          </div>
        )}

        {/* 通知列表 */}
        {loadState === "loaded" && (
          <ul
            className="flex flex-col gap-2"
            role="list"
            aria-label={t("notifications.title")}
          >
            {items.map((item) => (
              <li key={item.id}>
                <NotificationCard item={item} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
