// 记忆账本 —— 查看/筛选/编辑/删除跨厂商提炼的记忆；每条可溯源回跳原会话。
import { useEffect, useMemo, useState } from "react";
import { Virtualizer } from "virtua";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { listMemories, updateMemoryRecord, deleteMemoryRecord } from "@/lib/pb/memory";
import { listProjects } from "@/lib/pb/board";
import { type Memory, type MemoryKind } from "@/types/memory";
import type { BoardProject } from "@/types/board";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/markdown";
import { MemoryEditDialog } from "@/features/memory/MemoryEditDialog";
import { importFileMemories } from "@/features/memory/import-file-memories";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const KINDS: (MemoryKind | "all")[] = ["all", "fact", "preference", "decision", "convention"];

export default function MemoryPage() {
  const navigate = useNavigate();
  const { t } = useTranslation(["memory", "common"]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [projects, setProjects] = useState<BoardProject[]>([]);
  const [loading, setLoading] = useState(true);
  // project id → 名称（记忆卡片展示所属项目）
  const projName = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );
  // 某记忆的项目名标签（scope=project 且能解析出名字才显示具体项目）
  const scopeLabel = (m: Memory): string => {
    if (m.scope !== "project") return t("page.scopeGlobal");
    const n = m.project ? projName.get(m.project) : undefined;
    return n ? t("page.scopeProject", { name: n }) : t("page.scopeProjectUnknown");
  };
  const [kind, setKind] = useState<MemoryKind | "all">("all");
  // 作用域筛选："all" / "global" / "project:<id>"（具体项目）
  const [scope, setScope] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Memory | null>(null);
  // 批量选择
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const [importing, setImporting] = useState(false);

  const load = () => {
    setLoading(true);
    listMemories()
      .then(setMemories)
      .catch(() => setMemories([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  // 项目列表（记忆卡片显示所属项目名）
  useEffect(() => {
    void listProjects().then(setProjects).catch(() => {});
  }, []);

  // 记忆桥：把 Claude 文件记忆(*.md)导入账本(待审)，导入后进收件箱等采纳
  const handleImportFileMemories = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const r = await importFileMemories();
      if (r.imported === 0 && r.skipped === 0) {
        toast.message(t("page.importNone"));
      } else {
        toast.success(t("page.importSuccess", { imported: r.imported, skipped: r.skipped }));
        load();
      }
    } catch (e) {
      toast.error(t("page.importError", { msg: String(e instanceof Error ? e.message : e) }));
    } finally {
      setImporting(false);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return memories.filter(
      (m) =>
        !m.superseded_by &&
        m.status !== "pending" && // 待审记忆单独展示，不混入主账本
        (kind === "all" || m.kind === kind) &&
        // 作用域：all=全部 / global=全局 / project:<id>=指定项目
        (scope === "all" ||
          (scope === "global" && m.scope === "global") ||
          (scope.startsWith("project:") && m.project === scope.slice("project:".length))) &&
        (!q || m.content.toLowerCase().includes(q)),
    );
  }, [memories, kind, scope, query]);

  // 待审记忆（外部 AI 经 MCP create_memory 写入，需采纳后才入账）
  const pending = useMemo(
    () => memories.filter((m) => m.status === "pending" && !m.superseded_by),
    [memories],
  );

  // 采纳：置为 accepted，正式入账
  const accept = async (m: Memory) => {
    setMemories((prev) =>
      prev.map((x) => (x.id === m.id ? { ...x, status: "accepted" } : x)),
    );
    try {
      await updateMemoryRecord(m.id, { status: "accepted" });
    } catch (e) {
      toast.error(t("page.acceptError", { msg: String(e) }));
      load();
    }
  };

  const remove = async (m: Memory) => {
    setMemories((prev) => prev.filter((x) => x.id !== m.id));
    try {
      await deleteMemoryRecord(m.id);
    } catch (e) {
      toast.error(t("page.deleteError", { msg: String(e) }));
      load();
    }
  };

  // 批量删除所选记忆（逐条删；失败则重载兜底）
  const batchDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setMemories((prev) => prev.filter((x) => !selected.has(x.id)));
    exitSelect();
    try {
      for (const id of ids) await deleteMemoryRecord(id);
      toast.success(t("page.batchDeleteSuccess", { count: ids.length }));
    } catch (e) {
      toast.error(t("page.batchDeleteError", { msg: String(e) }));
      load();
    }
  };

  const saveEdit = async (value: string | null) => {
    const m = editing;
    setEditing(null);
    if (m === null || value === null) return;
    const content = value.trim();
    if (!content) return;
    setMemories((prev) => prev.map((x) => (x.id === m.id ? { ...x, content } : x)));
    try {
      await updateMemoryRecord(m.id, { content });
    } catch (e) {
      toast.error(t("page.saveError", { msg: String(e) }));
      load();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      <header className="mb-4 flex shrink-0 items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold text-foreground">{t("page.title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("page.description")}
          </p>
        </div>
        {/* 记忆桥：导入 Claude 文件记忆(*.md) → 待审收件箱 */}
        <Button
          variant="outline"
          size="sm"
          disabled={importing}
          onClick={() => void handleImportFileMemories()}
          title={t("page.importButtonTitle")}
        >
          {importing ? t("page.importingLabel") : t("page.importButton")}
        </Button>
      </header>

      {/* 待审记忆（外部 AI 经 MCP 写入，采纳后才进主账本；防 AI 乱写污染） */}
      {pending.length > 0 && (
        <div className="mb-3 shrink-0 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            {t("page.pendingTitle", { count: pending.length })}
            <span className="font-normal text-muted-foreground">
              {t("page.pendingDesc")}
            </span>
          </div>
          <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto">
            {pending.map((m) => (
              <div
                key={m.id}
                className="flex items-start gap-2 rounded-lg border border-border bg-card p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="break-words text-sm text-foreground">
                    <Markdown content={m.content} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="rounded bg-muted px-1">{t(`kind.${m.kind}`)}</span>
                    <span className="rounded bg-muted px-1">{scopeLabel(m)}</span>
                    {m.source_provider && (
                      <span className="rounded bg-muted px-1">{t("page.sourceProvider", { provider: m.source_provider })}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="xs" onClick={() => void accept(m)}>
                    {t("page.acceptButton")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void remove(m)}
                  >
                    {t("page.discardButton")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 筛选 */}
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={(v) => setKind(v as MemoryKind | "all")}>
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {k === "all" ? t("page.filterAllKinds") : t(`kind.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("page.filterAllScopes")}</SelectItem>
            <SelectItem value="global">{t("page.scopeGlobal")}</SelectItem>
            {/* 有记忆归属的项目逐个列出，直接按项目筛 */}
            {projects
              .filter((p) => memories.some((m) => m.project === p.id))
              .map((p) => (
                <SelectItem key={p.id} value={`project:${p.id}`}>
                  {t("page.scopeProject", { name: p.name })}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("page.searchPlaceholder")}
          className="h-9 max-w-xs flex-1"
        />
        <span className="ml-auto text-xs text-muted-foreground">{t("page.countLabel", { count: visible.length })}</span>
        <button
          type="button"
          onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          aria-pressed={selectMode}
          className={`shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors ${
            selectMode ? "bg-accent text-primary" : "text-muted-foreground hover:bg-accent/50"
          }`}
        >
          {t("page.batchButton")}
        </button>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{t("common:state.loading")}</p>
        ) : visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {t("page.emptyHint")}
          </p>
        ) : (
          <Virtualizer>
            {visible.map((m) => {
              const isSel = selected.has(m.id);
              return (
                <div
                  key={m.id}
                  onClick={selectMode ? () => toggleSel(m.id) : undefined}
                  className={`group mb-1.5 flex items-start gap-2.5 rounded-lg border p-2.5 ${
                    selectMode ? "cursor-pointer" : ""
                  } ${
                    isSel ? "border-primary/60 bg-primary/5" : "border-border bg-card"
                  }`}
                >
                  {selectMode && (
                    <input
                      type="checkbox"
                      checked={isSel}
                      readOnly
                      className="mt-0.5 size-3.5 shrink-0 accent-primary"
                      aria-label={t("page.selectCheckboxLabel")}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    {/* 内容按 markdown 渲染（可能是 markdown 数据；多行完整展示） */}
                    <div className="break-words text-foreground">
                      <Markdown content={m.content} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="rounded bg-muted px-1">{t(`kind.${m.kind}`)}</span>
                      <span className="rounded bg-muted px-1">{scopeLabel(m)}</span>
                      <span>{t("page.confidence", { confidence: m.confidence })}</span>
                      {m.source_session_id && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/sessions?session=${m.source_session_id}`);
                          }}
                          className="text-primary hover:underline"
                          title={t("page.sourceSessionTitle")}
                        >
                          {t("page.sourceSessionLink")}
                        </button>
                      )}
                    </div>
                  </div>
                  {!selectMode && (
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button variant="ghost" size="xs" onClick={() => setEditing(m)}>
                        {t("common:action.edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void remove(m)}
                      >
                        {t("common:action.delete")}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </Virtualizer>
        )}
      </div>

      {/* 批量操作栏（多选模式浮现） */}
      {selectMode && (
        <div className="mt-2 flex shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t("page.selectedCount", { count: selected.size })}</span>
          <Button
            variant="ghost"
            size="xs"
            disabled={selected.size === 0}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => void batchDelete()}
          >
            {t("page.deleteSelectedButton")}
          </Button>
          <Button variant="ghost" size="xs" className="ml-auto" onClick={exitSelect}>
            {t("page.exitSelectButton")}
          </Button>
        </div>
      )}

      {/* 编辑记忆（markdown 编辑器：源码 + 预览） */}
      <MemoryEditDialog
        open={editing !== null}
        defaultValue={editing?.content ?? ""}
        onResult={saveEdit}
      />
    </div>
  );
}
