// 收件箱 —— 把所有通知聚成可批处理的一页：按来源/未读过滤、多选、批量已读/删除、点击跳转。
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Virtualizer } from "virtua";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useNotificationsStore } from "@/store/notifications";
import { useNotifPrefsStore } from "@/store/notification-prefs";
import type { AppNotification, NotificationKind } from "@/types/notifications";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const KIND_DOT: Record<NotificationKind, string> = {
  info: "bg-sky-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-destructive",
};

/** 相对时间简版（复用 MM-DD HH:mm 兜底）。 */
function whenLabel(
  iso: string,
  tFn: (key: string, opts: Record<string, unknown>) => string,
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const min = 60_000, hour = 3_600_000, day = 86_400_000;
  if (diff < hour) return tFn("time.minutesAgo", { count: Math.max(1, Math.floor(diff / min)) });
  if (diff < day) return tFn("time.hoursAgo", { count: Math.floor(diff / hour) });
  if (diff < 7 * day) return tFn("time.daysAgo", { count: Math.floor(diff / day) });
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function InboxPage() {
  const { t } = useTranslation(["inbox", "common"]);
  const navigate = useNavigate();
  const allItems = useNotificationsStore((s) => s.items);
  const load = useNotificationsStore((s) => s.load);
  // 按通知类型偏好过滤（覆盖 MCP/Loop 等外部写入的类型）
  const prefs = useNotifPrefsStore((s) => s.prefs);
  const items = allItems.filter((n) => {
    if (!n.source) return true; // 无 source 始终显示
    return prefs[n.source] !== false; // 未知 source 默认 true
  });
  const markRead = useNotificationsStore((s) => s.markRead);
  const markManyRead = useNotificationsStore((s) => s.markManyRead);
  const removeMany = useNotificationsStore((s) => s.removeMany);

  const [unreadOnly, setUnreadOnly] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    void load();
  }, [load]);

  // 来源下拉选项（去重）
  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const n of items) if (n.source) set.add(n.source);
    return [...set].sort();
  }, [items]);

  const visible = useMemo(
    () =>
      items.filter(
        (n) =>
          (!unreadOnly || !n.read) &&
          (sourceFilter === "all" || n.source === sourceFilter),
      ),
    [items, unreadOnly, sourceFilter],
  );

  const allChecked = visible.length > 0 && visible.every((n) => checked.has(n.id));
  const toggleAll = () =>
    setChecked(allChecked ? new Set() : new Set(visible.map((n) => n.id)));
  const toggleOne = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedIds = [...checked].filter((id) => visible.some((n) => n.id === id));

  const openItem = (n: AppNotification) => {
    if (!n.read) void markRead(n.id).catch((e) => toast.error(t("inbox:item.markReadError", { msg: String(e) })));
    if (n.link) navigate(n.link);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      <header className="mb-4 shrink-0">
        <h1 className="font-heading text-xl font-semibold text-foreground">{t("inbox:page.title")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t("inbox:page.subtitle")}
        </p>
      </header>

      {/* 过滤 + 批量工具栏 */}
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setUnreadOnly((v) => !v)}
          className={`rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors ${
            unreadOnly ? "bg-accent text-primary" : "text-muted-foreground hover:bg-accent/50"
          }`}
        >
          {t("inbox:filter.unreadOnly")}{unreadOnly ? " ✓" : ""}
        </button>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue placeholder={t("inbox:filter.allSources")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("inbox:filter.allSources")}</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1.5">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} className="size-3.5 accent-primary" />
            {t("inbox:bulk.selectAll")}
          </label>
          <Button
            variant="ghost"
            size="xs"
            disabled={selectedIds.length === 0}
            onClick={() =>
              void markManyRead(selectedIds).catch((e) =>
                toast.error(t("inbox:bulk.markReadError", { msg: String(e) })),
              )
            }
          >
            {t("inbox:bulk.markRead")}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={selectedIds.length === 0}
            onClick={() => {
              void removeMany(selectedIds).catch((e) =>
                toast.error(t("inbox:bulk.deleteError", { msg: String(e) })),
              );
              setChecked(new Set());
            }}
          >
            {t("common:action.delete")}
          </Button>
        </div>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {unreadOnly ? t("inbox:empty.unread") : t("inbox:empty.all")}
          </p>
        ) : (
          <Virtualizer>
            {visible.map((n) => (
              <div
                key={n.id}
                className={`mb-1.5 flex items-start gap-2.5 rounded-lg border border-border p-2.5 ${
                  n.read ? "bg-card" : "bg-primary/5"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked.has(n.id)}
                  onChange={() => toggleOne(n.id)}
                  className="mt-1 size-3.5 shrink-0 accent-primary"
                  aria-label={t("inbox:item.selectAriaLabel")}
                />
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${KIND_DOT[n.kind] ?? "bg-muted-foreground"}`} />
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className={`truncate text-sm ${n.read ? "text-foreground" : "font-medium text-foreground"}`}>
                      {n.title}
                    </span>
                    {n.source && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {n.source}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
                      {whenLabel(n.created, (key, opts) => t(`inbox:${key}`, opts))}
                    </span>
                  </div>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                </button>
              </div>
            ))}
          </Virtualizer>
        )}
      </div>
    </div>
  );
}
