import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useSessionsStore } from "../../store/sessions";
import { useSessionSearchStore } from "../../store/session-search";
import { SessionCard } from "./SessionCard";
import { PromoteToProjectDialog } from "../board/PromoteToProjectDialog";
import type { Session } from "../../types/session";

// ── Props ──────────────────────────────────────────────────
interface SessionListViewProps {
  /** 当前选中的会话（用于高亮卡片） */
  selectedId: string | null;
  /** 用户选中某张卡片时的回调 */
  onSelect: (session: Session) => void;
}

/**
 * 会话列表视图。
 * - 有搜索词时：展示 useSessionSearchStore.results 的扁平列表。
 * - 无搜索词时：按 project_path 分组展示 useSessionsStore.groups。
 * 顶部提供搜索框，输入内容实时调用 useSessionSearchStore.run。
 */
export function SessionListView({ selectedId, onSelect }: SessionListViewProps) {
  const loading = useSessionsStore((s) => s.loading);
  const groups = useSessionsStore((s) => s.groups);
  const scanned = useSessionsStore((s) => s.scanned);

  const query = useSessionSearchStore((s) => s.query);
  const results = useSessionSearchStore((s) => s.results);
  const run = useSessionSearchStore((s) => s.run);
  const searchLoading = useSessionSearchStore((s) => s.loading);

  // 搜索词非空时进入搜索模式
  const isSearching = query.trim().length > 0;

  // 本地状态：当前正在“提升为看板项目”的分组路径（null = 未打开对话框）
  const [promotingPath, setPromotingPath] = useState<string | null>(null);
  // 已折叠的分组路径集合（项目多时可折叠收纳）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 搜索框 */}
      <div className="shrink-0">
        <input
          type="search"
          value={query}
          onChange={(e) => run(e.target.value)}
          placeholder="搜索会话…"
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="搜索会话"
        />
      </div>

      {/* 内容区：可滚动 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          // 加载状态
          <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
        ) : isSearching ? (
          // ── 搜索结果视图（Tantivy 全文检索，覆盖全部消息）──────
          <div className="flex flex-col gap-2">
            {searchLoading && results.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">检索中…</p>
            ) : results.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                未找到匹配的会话
              </p>
            ) : (
              results.map((session) => (
                <SessionCard
                  key={session.session_id}
                  session={session}
                  selected={session.session_id === selectedId}
                  onSelect={onSelect}
                />
              ))
            )}
          </div>
        ) : (
          // ── 分组视图 ──────────────────────────────────────
          <div className="flex flex-col gap-4">
            {Object.keys(groups).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {scanned ? "暂无会话记录" : "正在扫描本地会话…"}
              </p>
            ) : (
              Object.entries(groups).map(([projectPath, sessions]) => {
                // 从完整路径提取可读的项目名
                const projectName =
                  projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? projectPath;
                const isCollapsed = collapsed.has(projectPath);
                return (
                  <section key={projectPath}>
                    {/* 分组标题行：折叠切换（名称+计数）+ “提升为看板项目”入口 */}
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => toggleCollapse(projectPath)}
                        title={isCollapsed ? "展开" : "折叠"}
                        aria-expanded={!isCollapsed}
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <HugeiconsIcon
                          icon={ArrowRight01Icon}
                          strokeWidth={2}
                          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
                            isCollapsed ? "" : "rotate-90"
                          }`}
                        />
                        <span
                          className="min-w-0 truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                          title={projectPath}
                        >
                          {projectName}
                        </span>
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                          {sessions.length}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPromotingPath(projectPath)}
                        title="提升为看板项目"
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        提升为看板项目
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div className="flex flex-col gap-1.5">
                        {sessions.map((session) => (
                          <SessionCard
                            key={session.session_id}
                            session={session}
                            selected={session.session_id === selectedId}
                            onSelect={onSelect}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* 提升为看板项目对话框（受本地状态控制） */}
      {promotingPath && (
        <PromoteToProjectDialog
          projectPath={promotingPath}
          onClose={() => setPromotingPath(null)}
        />
      )}
    </div>
  );
}
