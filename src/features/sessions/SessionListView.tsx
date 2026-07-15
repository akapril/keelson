import { useSessionsStore } from "../../store/sessions";
import { useSessionSearchStore } from "../../store/session-search";
import { SessionCard } from "./SessionCard";
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

  const query = useSessionSearchStore((s) => s.query);
  const results = useSessionSearchStore((s) => s.results);
  const run = useSessionSearchStore((s) => s.run);

  // 搜索词非空时进入搜索模式
  const isSearching = query.trim().length > 0;

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
          // ── 搜索结果视图 ──────────────────────────────────
          <div className="flex flex-col gap-2">
            {results.length === 0 ? (
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
                暂无会话记录
              </p>
            ) : (
              Object.entries(groups).map(([projectPath, sessions]) => {
                // 从完整路径提取可读的项目名
                const projectName =
                  projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? projectPath;
                return (
                  <section key={projectPath}>
                    {/* 分组标题 */}
                    <h2
                      className="mb-2 truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      title={projectPath}
                    >
                      {projectName}
                    </h2>
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
                  </section>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
