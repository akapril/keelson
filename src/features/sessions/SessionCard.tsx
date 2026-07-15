import type { Session } from "../../types/session";
import { useSessionMetaStore } from "../../store/session-meta";

// ── 工具函数：截断 last_prompt 文本 ────────────────────────
/** 将字符串截断至 maxLen 字符，超出部分用省略号代替 */
export function truncate(text: string, maxLen = 80): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "…";
}

// ── Props ──────────────────────────────────────────────────
interface SessionCardProps {
  session: Session;
  /** 是否为当前选中的卡片 */
  selected: boolean;
  /** 用户点击卡片时的回调 */
  onSelect: (session: Session) => void;
}

/**
 * 单条会话卡片。
 * 展示：项目名称、provider、最后一条提示词（截断）、消息数量、收藏星标。
 */
export function SessionCard({ session, selected, onSelect }: SessionCardProps) {
  const favorites = useSessionMetaStore((s) => s.favorites);
  const toggleFavorite = useSessionMetaStore((s) => s.toggleFavorite);

  // 从 project_path 提取最后一段作为项目名
  const projectName = session.project_path.split(/[\\/]/).filter(Boolean).at(-1) ?? session.project_path;
  const isFav = favorites.has(session.id);

  function handleStarClick(e: React.MouseEvent) {
    // 阻止冒泡，避免同时触发 onSelect
    e.stopPropagation();
    toggleFavorite(session.id);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(session)}
      onKeyDown={(e) => e.key === "Enter" && onSelect(session)}
      className={[
        // 基础卡片样式
        "flex cursor-pointer flex-col gap-1 rounded-lg border border-border p-3 text-left transition-colors",
        // 选中 vs 默认状态
        selected
          ? "bg-accent text-accent-foreground"
          : "bg-card text-card-foreground hover:bg-accent/50",
      ].join(" ")}
    >
      {/* 首行：项目名 + 收藏星标 */}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium" title={session.project_path}>
          {projectName}
        </span>
        <button
          aria-label={isFav ? "取消收藏" : "收藏"}
          onClick={handleStarClick}
          className="shrink-0 text-base leading-none text-muted-foreground transition-colors hover:text-primary"
        >
          {/* 实心星 / 空心星，使用 unicode 避免引入图标库 */}
          {isFav ? "★" : "☆"}
        </button>
      </div>

      {/* 第二行：provider 标签 + 消息数量 */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{session.provider}</span>
        <span>{session.message_count} 条消息</span>
      </div>

      {/* 第三行：last_prompt（用 summary 字段截断展示） */}
      {session.summary && (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {truncate(session.summary)}
        </p>
      )}
    </div>
  );
}
