import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Virtualizer, type VirtualizerHandle } from "virtua";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useSessionsStore } from "../../store/sessions";
import { useSessionMetaStore } from "../../store/session-meta";
import { useSessionSearchStore } from "../../store/session-search";
import { SessionCard } from "./SessionCard";
import { PromoteToProjectDialog } from "../board/PromoteToProjectDialog";
import { AskPane } from "./AskPane";
import { providerMeta } from "../../lib/providers";
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
  const { t } = useTranslation("sessions");
  const loading = useSessionsStore((s) => s.loading);
  const groups = useSessionsStore((s) => s.groups);
  const scanned = useSessionsStore((s) => s.scanned);

  const query = useSessionSearchStore((s) => s.query);
  const results = useSessionSearchStore((s) => s.results);
  const run = useSessionSearchStore((s) => s.run);
  const searchLoading = useSessionSearchStore((s) => s.loading);
  const favorites = useSessionMetaStore((s) => s.favorites);
  const hidden = useSessionMetaStore((s) => s.hidden);
  const toggleFavorite = useSessionMetaStore((s) => s.toggleFavorite);
  const toggleHidden = useSessionMetaStore((s) => s.toggleHidden);

  // 搜索词非空时进入搜索模式
  const isSearching = query.trim().length > 0;

  // 批量选择
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // useCallback：引用稳定，配合 SessionCard 的 React.memo，避免列表整体重渲时所有卡片跟着重渲。
  const toggleCheck = useCallback(
    (id: string) =>
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const exitSelect = () => {
    setSelectMode(false);
    setChecked(new Set());
  };
  // 批量动作：对所选按目标态幂等设置（已是目标态则跳过，避免误 toggle）
  const batchFavorite = () =>
    checked.forEach(
      (id) =>
        favorites.has(id) ||
        void toggleFavorite(id).catch((e) => toast.error(t("list.toast.favoriteError", { msg: String(e) }))),
    );
  const batchHide = () =>
    checked.forEach(
      (id) =>
        hidden.has(id) ||
        void toggleHidden(id).catch((e) => toast.error(t("list.toast.hideError", { msg: String(e) }))),
    );
  const batchUnhide = () =>
    checked.forEach(
      (id) =>
        hidden.has(id) &&
        void toggleHidden(id).catch((e) => toast.error(t("list.toast.hideError", { msg: String(e) }))),
    );

  // 「只看收藏」/「显示已隐藏」筛选
  const [favOnly, setFavOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  // provider 筛选：多选 toggle 集合。空集=全部（不过滤）；否则仅显示所选 provider。
  const [providerFilter, setProviderFilter] = useState<Set<string>>(new Set());
  const toggleProvider = (p: string) =>
    setProviderFilter((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  // 当前会话里「实际出现过」的 provider（去重，保持稳定排序），仅这些渲染成筛选 chip。
  const presentProviders = useMemo(() => {
    const set = new Set<string>();
    for (const s of results) set.add(s.provider);
    for (const list of Object.values(groups)) for (const s of list) set.add(s.provider);
    return [...set].sort();
  }, [results, groups]);

  // 单条是否应展示：默认排除已隐藏（除非显示隐藏）；favOnly 时仅收藏；provider 筛选命中。
  const keep = useMemo(
    () => (s: Session) =>
      (showHidden || !hidden.has(s.session_id)) &&
      (!favOnly || favorites.has(s.session_id)) &&
      (providerFilter.size === 0 || providerFilter.has(s.provider)),
    [showHidden, hidden, favOnly, favorites, providerFilter],
  );
  const shownResults = useMemo(
    () => results.filter((s) => keep(s)),
    [results, keep],
  );
  // 分组视图：过滤每组、丢弃空组
  const shownGroups = useMemo(() => {
    const out: Record<string, Session[]> = {};
    for (const [path, list] of Object.entries(groups)) {
      const kept = list.filter((s) => keep(s));
      if (kept.length) out[path] = kept;
    }
    return out;
  }, [groups, keep]);

  // 搜索 / 问历史 模式切换
  const [mode, setMode] = useState<"search" | "ask">("search");

  // 本地状态：当前正在"提升为看板项目"的分组路径（null = 未打开对话框）
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

  // 把「搜索扁平列表」与「分组视图」统一压平成一维行序列，交给 virtua 虚拟化：
  // 只渲染可视区行，会话成百上千也不卡。header 行 sticky 吸顶；折叠的分组不产出卡片行。
  type Row =
    | { kind: "header"; path: string; name: string; count: number; collapsed: boolean }
    | { kind: "card"; session: Session };
  const rows = useMemo<Row[]>(() => {
    if (isSearching) {
      return shownResults.map((s) => ({ kind: "card", session: s }));
    }
    const out: Row[] = [];
    for (const [path, sessions] of Object.entries(shownGroups)) {
      const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
      const isCollapsed = collapsed.has(path);
      out.push({ kind: "header", path, name, count: sessions.length, collapsed: isCollapsed });
      if (!isCollapsed) for (const s of sessions) out.push({ kind: "card", session: s });
    }
    return out;
  }, [isSearching, shownResults, shownGroups, collapsed]);

  // 外部选中会话但它被「分组折叠 / 收藏筛选 / 隐藏项」挡住时，自动放开以便定位。
  // 放开后 rows 重建 → 下面的滚动 effect(依赖 rows) 会接着把它滚进视野。
  // 搜索模式下结果由后端决定，不在此处理。
  useEffect(() => {
    if (!selectedId || isSearching) return;
    let path: string | null = null;
    for (const [p, list] of Object.entries(groups)) {
      if (list.some((s) => s.session_id === selectedId)) {
        path = p;
        break;
      }
    }
    if (!path) return; // 不在任何分组(可能非当前数据) → 无从展开
    // 被「只看收藏」挡住(非收藏) → 关掉 favOnly
    if (favOnly && !favorites.has(selectedId)) setFavOnly(false);
    // 被「隐藏项」挡住(已隐藏且未显示隐藏) → 打开 showHidden
    if (!showHidden && hidden.has(selectedId)) setShowHidden(true);
    // 被 provider 筛选挡住 → 清空筛选（让目标会话可见）
    if (providerFilter.size > 0) {
      const sel = groups[path]?.find((s) => s.session_id === selectedId);
      if (sel && !providerFilter.has(sel.provider)) setProviderFilter(new Set());
    }
    // 所属分组处于折叠 → 展开
    if (collapsed.has(path)) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(path!);
        return next;
      });
    }
    // setFav/Hidden/Collapsed 已覆盖会改 rows 的因素；无需把它们列入依赖触发自身
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, groups]);

  // 虚拟列表句柄：外部选中会话（深链 ?session= / ⌘K / 任务「来源会话」徽章）时，
  // 把列表滚动到该行并高亮定位——修复「跳转到会话后左侧列表没滚到那条」。
  const vRef = useRef<VirtualizerHandle>(null);
  useEffect(() => {
    if (!selectedId) return;
    const idx = rows.findIndex(
      (r) => r.kind === "card" && r.session.session_id === selectedId,
    );
    if (idx < 0) return; // 被搜索/收藏筛选或分组折叠隐藏 → 无对应行可滚
    // rAF 等 virtua 完成本轮布局后再滚；align:"nearest" 仅在目标不在可视区时才滚，
    // 避免点击已可见的卡片时列表突兀地重新居中。
    const raf = requestAnimationFrame(() =>
      vRef.current?.scrollToIndex(idx, { align: "nearest" }),
    );
    return () => cancelAnimationFrame(raf);
  }, [selectedId, rows]);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 搜索 / 问历史 模式切换 */}
      <div className="mb-2 flex gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setMode("search")}
          className={`rounded-lg px-2.5 py-1 text-xs ${mode === "search" ? "bg-accent" : "text-muted-foreground"}`}
        >
          {t("list.modeSearch")}
        </button>
        <button
          type="button"
          onClick={() => setMode("ask")}
          className={`rounded-lg px-2.5 py-1 text-xs ${mode === "ask" ? "bg-accent" : "text-muted-foreground"}`}
        >
          {t("list.modeAsk")}
        </button>
      </div>

      {/* 问历史模式 */}
      {mode === "ask" && <AskPane />}

      {/* 搜索模式：原有搜索框 + 列表 */}
      {mode === "search" && (
        <>
      {/* 搜索框 + 只看收藏 */}
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => run(e.target.value)}
          placeholder={t("list.searchPlaceholder")}
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label={t("list.searchAriaLabel")}
        />
        <button
          type="button"
          onClick={() => setFavOnly((v) => !v)}
          title={favOnly ? t("list.showAllTitle") : t("list.favOnlyTitle")}
          aria-pressed={favOnly}
          className={`shrink-0 rounded-lg border border-border px-2.5 py-2 text-sm leading-none transition-colors ${
            favOnly ? "bg-accent text-primary" : "text-muted-foreground hover:bg-accent/50"
          }`}
        >
          {favOnly ? "★" : "☆"}
        </button>
        <button
          type="button"
          onClick={() => setShowHidden((v) => !v)}
          title={showHidden ? t("list.showHiddenTitleActive") : t("list.showHiddenTitle")}
          aria-pressed={showHidden}
          className={`shrink-0 rounded-lg border border-border px-2.5 py-2 text-xs leading-none transition-colors ${
            showHidden ? "bg-accent text-primary" : "text-muted-foreground hover:bg-accent/50"
          }`}
        >
          {showHidden ? t("list.showHiddenActive") : t("list.showHidden")}
        </button>
        <button
          type="button"
          onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          title={t("list.batchSelectTitle")}
          aria-pressed={selectMode}
          className={`shrink-0 rounded-lg border border-border px-2.5 py-2 text-xs leading-none transition-colors ${
            selectMode ? "bg-accent text-primary" : "text-muted-foreground hover:bg-accent/50"
          }`}
        >
          {t("list.batchSelect")}
        </button>
      </div>

      {/* provider 筛选 chips：仅列出会话里实际出现过的 provider；多选 toggle，全不选=全部 */}
      {presentProviders.length > 1 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {presentProviders.map((p) => {
            const meta = providerMeta(p);
            const active = providerFilter.has(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => toggleProvider(p)}
                aria-pressed={active}
                title={t("list.filterByProvider", { provider: meta.label })}
                className={[
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                  active
                    ? `border-transparent ${meta.chip}`
                    : "border-border text-muted-foreground hover:bg-accent/50",
                ].join(" ")}
              >
                <span className={`size-1.5 shrink-0 rounded-full ${meta.dot}`} />
                {meta.label}
              </button>
            );
          })}
        </div>
      )}

      {/* 批量选择工具栏 */}
      {selectMode && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5 text-xs">
          <span className="mr-1 text-muted-foreground">{t("list.batchSelectedCount", { n: checked.size })}</span>
          <button
            type="button"
            disabled={checked.size === 0}
            onClick={batchFavorite}
            className="rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-40"
          >
            {t("list.batchFavorite")}
          </button>
          <button
            type="button"
            disabled={checked.size === 0}
            onClick={batchHide}
            className="rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-40"
          >
            {t("list.batchHide")}
          </button>
          <button
            type="button"
            disabled={checked.size === 0}
            onClick={batchUnhide}
            className="rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-40"
          >
            {t("list.batchUnhide")}
          </button>
          <button
            type="button"
            onClick={exitSelect}
            className="ml-auto rounded px-1.5 py-0.5 text-primary hover:bg-accent"
          >
            {t("list.batchDone")}
          </button>
        </div>
      )}

      {/* 内容区：可滚动 + virtua 虚拟化（只渲染可视区行，会话极多也不卡死） */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("list.loading")}</p>
        ) : isSearching && searchLoading && results.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("list.searching")}</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {isSearching
              ? favOnly
                ? t("list.emptyFav")
                : t("list.emptySearch")
              : favOnly
                ? t("list.emptyFav")
                : scanned
                  ? t("list.empty")
                  : t("list.emptyScanning")}
          </p>
        ) : (
          <Virtualizer ref={vRef}>
            {rows.map((row) =>
              row.kind === "header" ? (
                // 分组标题行：sticky 吸顶；折叠开关 + 提升为看板项目
                <div
                  key={`h:${row.path}`}
                  className="sticky top-0 z-10 mb-1 mt-3 flex items-center justify-between gap-2 bg-background pb-1.5 pt-0.5 first:mt-0"
                >
                  <button
                    type="button"
                    onClick={() => toggleCollapse(row.path)}
                    title={row.collapsed ? t("list.expandTitle") : t("list.collapseTitle")}
                    aria-expanded={!row.collapsed}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      strokeWidth={2}
                      className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
                        row.collapsed ? "" : "rotate-90"
                      }`}
                    />
                    <span
                      className="min-w-0 truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      title={row.path}
                    >
                      {row.name}
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                      {row.count}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPromotingPath(row.path)}
                    title={t("list.promoteTitle")}
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {t("list.promoteTitle")}
                  </button>
                </div>
              ) : (
                <div key={row.session.session_id} className="pb-1.5">
                  <SessionCard
                    session={row.session}
                    selected={row.session.session_id === selectedId}
                    onSelect={onSelect}
                    selectMode={selectMode}
                    checked={checked.has(row.session.session_id)}
                    onToggleCheck={toggleCheck}
                  />
                </div>
              ),
            )}
          </Virtualizer>
        )}
      </div>
        </>
      )}

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
