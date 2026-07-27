import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";
import type { Session } from "../../types/session";
import { useSessionMetaStore } from "../../store/session-meta";
import { RestoreDialog } from "./RestoreDialog";
import { CreateTaskFromSessionDialog } from "../board/CreateTaskFromSessionDialog";
import { MemoryReviewDialog } from "../memory/MemoryReviewDialog";
import { PromptDialog } from "@/components/prompt-dialog";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

// ── 工具函数：截断 last_prompt 文本 ────────────────────────
/** 将字符串截断至 maxLen 字符，超出部分用省略号代替 */
export function truncate(text: string, maxLen = 80): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "…";
}

/**
 * 相对时间差值（毫秒和时段）：供 SessionCard 内部使用 t() 格式化。
 * 解析失败返回 null。纯函数、可测。
 */
export function relativeTimeParts(
  iso: string,
  now: number = Date.now(),
): { kind: "justNow" | "minutes" | "hours" | "days" | "date"; n?: number; dateStr?: string } | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diff = Math.max(0, now - t);
  const min = 60_000, hour = 3_600_000, day = 86_400_000;
  if (diff < min) return { kind: "justNow" };
  if (diff < hour) return { kind: "minutes", n: Math.floor(diff / min) };
  if (diff < day) return { kind: "hours", n: Math.floor(diff / hour) };
  if (diff < 7 * day) return { kind: "days", n: Math.floor(diff / day) };
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return { kind: "date", dateStr: `${p(d.getMonth() + 1)}-${p(d.getDate())}` };
}

/**
 * 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / MM-DD（超 7 天）。
 * 解析失败返回空串（不显示）。纯函数、可测。
 * @deprecated 测试用兼容导出；组件内部使用 relativeTimeParts + t()
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const parts = relativeTimeParts(iso, now);
  if (!parts) return "";
  if (parts.kind === "justNow") return "刚刚";
  if (parts.kind === "minutes") return `${parts.n} 分钟前`;
  if (parts.kind === "hours") return `${parts.n} 小时前`;
  if (parts.kind === "days") return `${parts.n} 天前`;
  return parts.dateStr ?? "";
}

// ── Props ──────────────────────────────────────────────────
interface SessionCardProps {
  session: Session;
  /** 是否为当前选中的卡片 */
  selected: boolean;
  /** 用户点击卡片时的回调 */
  onSelect: (session: Session) => void;
  /** 批量选择模式：为 true 时点击卡片切换勾选而非打开会话 */
  selectMode?: boolean;
  /** 批量选择中是否已勾选 */
  checked?: boolean;
  /** 切换勾选回调 */
  onToggleCheck?: (sessionId: string) => void;
}

/**
 * 单条会话卡片。
 * 展示：项目名称、provider、最后一条提示词（截断）、消息数量、收藏星标。
 */
function SessionCardImpl({
  session,
  selected,
  onSelect,
  selectMode = false,
  checked = false,
  onToggleCheck,
}: SessionCardProps) {
  const { t } = useTranslation("sessions");

  // 性能：按本卡 session_id 精确订阅（返回布尔/字符串），只有自身值变化才重渲染，
  // 避免任一会话的收藏/隐藏/改名触发整列表所有卡片重渲染。动作函数引用稳定。
  const isFav = useSessionMetaStore((s) => s.favorites.has(session.session_id));
  const isHidden = useSessionMetaStore((s) => s.hidden.has(session.session_id));
  const customName = useSessionMetaStore((s) => s.customNames.get(session.session_id));
  const toggleFavorite = useSessionMetaStore((s) => s.toggleFavorite);
  const toggleHidden = useSessionMetaStore((s) => s.toggleHidden);
  const setCustomName = useSessionMetaStore((s) => s.setCustomName);

  // 控制恢复对话框的显示状态
  const [restoreTarget, setRestoreTarget] = useState<Session | null>(null);
  // 控制"从会话建任务"对话框的显示状态
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  // 重命名对话框
  const [renameOpen, setRenameOpen] = useState(false);
  // 提炼记忆对话框
  const [memoryOpen, setMemoryOpen] = useState(false);

  // 显示名：自定义名优先，否则 Rust 序列化的 project_name
  const displayName = customName || session.project_name;

  // 相对时间：根据时间差选对应 i18n key
  function formatRelativeTime(iso: string): string {
    const parts = relativeTimeParts(iso);
    if (!parts) return "";
    if (parts.kind === "justNow") return t("card.timeJustNow");
    if (parts.kind === "minutes") return t("card.timeMinutesAgo", { n: parts.n });
    if (parts.kind === "hours") return t("card.timeHoursAgo", { n: parts.n });
    if (parts.kind === "days") return t("card.timeDaysAgo", { n: parts.n });
    return parts.dateStr ?? "";
  }

  // 改名：风格化对话框；取消(null)不动，空串=清除自定义名恢复默认
  function handleRenameResult(value: string | null) {
    setRenameOpen(false);
    if (value === null) return;
    void setCustomName(session.session_id, value).catch((e) =>
      toast.error(t("card.toast.saveNameError", { msg: String(e) })),
    );
  }

  function handleStarClick(e: React.MouseEvent) {
    // 阻止冒泡，避免同时触发 onSelect
    e.stopPropagation();
    void toggleFavorite(session.session_id).catch((e) =>
      toast.error(t("card.toast.favoriteError", { msg: String(e) })),
    );
  }

  function handleRestoreClick(e: React.MouseEvent) {
    // 阻止冒泡，避免触发卡片选中
    e.stopPropagation();
    setRestoreTarget(session);
  }

  function handleCreateTaskClick(e: React.MouseEvent) {
    // 阻止冒泡，避免触发卡片选中
    e.stopPropagation();
    setTaskDialogOpen(true);
  }

  const relTime = formatRelativeTime(session.updated_at);

  return (
    <>
      <ContextMenu>
      <ContextMenuTrigger asChild>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selectMode ? checked : selected}
        onClick={() => (selectMode ? onToggleCheck?.(session.session_id) : onSelect(session))}
        onKeyDown={(e) =>
          e.key === "Enter" &&
          (selectMode ? onToggleCheck?.(session.session_id) : onSelect(session))
        }
        className={[
          // 基础卡片样式
          "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
          // 勾选(批量) / 选中(预览) / 默认
          selectMode && checked
            ? "border-primary bg-primary/10"
            : selected
              ? "border-border bg-accent text-accent-foreground"
              : "border-border bg-card text-card-foreground hover:bg-accent/50",
          // 已隐藏（仅在"显示隐藏"时可见）淡化区分
          isHidden ? "opacity-55" : "",
        ].join(" ")}
      >
        {/* 首行：[批量勾选框] + 项目名 + 收藏星标 + 恢复按钮 */}
        <div className="flex items-center justify-between gap-2">
          {selectMode && (
            <input
              type="checkbox"
              checked={checked}
              readOnly
              className="size-3.5 shrink-0 rounded border-input accent-primary"
              aria-label={t("card.selectSession")}
            />
          )}
          <span
            className="min-w-0 flex-1 truncate text-sm font-medium"
            title={customName ? `${customName}（${session.project_path}）` : session.project_path}
          >
            {displayName}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* 建任务按钮：打开"从会话建任务"对话框（阻止冒泡避免选中卡片） */}
            <button
              aria-label={t("card.createTask")}
              onClick={handleCreateTaskClick}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            >
              {t("card.createTask")}
            </button>
            {/* 恢复按钮：打开恢复对话框 */}
            <button
              aria-label={t("card.restore")}
              onClick={handleRestoreClick}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            >
              {t("card.restore")}
            </button>
            {/* 收藏星标 */}
            <button
              aria-label={isFav ? t("card.unfavorite") : t("card.favorite")}
              onClick={handleStarClick}
              className="text-base leading-none text-muted-foreground transition-colors hover:text-primary"
            >
              {/* 实心星 / 空心星，使用 unicode 避免引入图标库 */}
              {isFav ? "★" : "☆"}
            </button>
          </div>
        </div>

        {/* 第二行：provider 标签 + 消息数量 + 相对时间（更新时间） */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{session.provider}</span>
          <span>{t("card.messageCount", { n: session.message_count })}</span>
          {relTime && (
            <span className="ml-auto shrink-0" title={session.updated_at}>
              {relTime}
            </span>
          )}
        </div>

        {/* 第三行：last_prompt 截断展示 */}
        {session.last_prompt && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {truncate(session.last_prompt)}
          </p>
        )}
      </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => setRestoreTarget(session)}>
          {t("card.ctx.restoreSession")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => setTaskDialogOpen(true)}>{t("card.ctx.createTask")}</ContextMenuItem>
        <ContextMenuItem onSelect={() => setMemoryOpen(true)}>{t("card.ctx.distillMemory")}</ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            void toggleFavorite(session.session_id).catch((e) =>
              toast.error(t("card.toast.favoriteError", { msg: String(e) })),
            )
          }
        >
          {isFav ? t("card.ctx.unfavorite") : t("card.ctx.favorite")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => setRenameOpen(true)}>
          {customName ? t("card.ctx.renameOrReset") : t("card.ctx.rename")}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            void toggleHidden(session.session_id).catch((e) =>
              toast.error(t("card.toast.hideError", { msg: String(e) })),
            )
          }
        >
          {isHidden ? t("card.ctx.unhide") : t("card.ctx.hide")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() =>
            void ipc
              .openPath(session.project_path)
              .catch((e) => toast.error(t("card.toast.openLocationError", { msg: String(e) })))
          }
        >
          {t("card.ctx.openLocation")}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            void navigator.clipboard
              .writeText(session.project_path)
              .then(() => toast.success(t("card.toast.copiedPath")))
          }
        >
          {t("card.ctx.copyPath")}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            void navigator.clipboard
              .writeText(session.session_id)
              .then(() => toast.success(t("card.toast.copiedId")))
          }
        >
          {t("card.ctx.copyId")}
        </ContextMenuItem>
      </ContextMenuContent>
      </ContextMenu>

      {/* 对话框一律「懒挂载」——仅在触发时才渲染，避免每张卡片常驻 3 个 Radix 对话框树
          （会话多时挂载成本叠加导致卡顿/卡死）。 */}
      {restoreTarget && (
        <RestoreDialog session={restoreTarget} onClose={() => setRestoreTarget(null)} />
      )}

      {taskDialogOpen && (
        <CreateTaskFromSessionDialog
          session={session}
          onClose={() => setTaskDialogOpen(false)}
        />
      )}

      {memoryOpen && (
        <MemoryReviewDialog session={session} onClose={() => setMemoryOpen(false)} />
      )}

      {renameOpen && (
        <PromptDialog
          open
          title={t("rename.title")}
          description={t("rename.description")}
          label={t("rename.label")}
          placeholder={t("rename.placeholder")}
          defaultValue={customName ?? ""}
          confirmText={t("common:action.save")}
          onResult={handleRenameResult}
        />
      )}
    </>
  );
}

// memo：配合上面的「按 session_id 精确订阅」，只有本卡相关 props/状态变化才重渲染。
export const SessionCard = memo(SessionCardImpl);
