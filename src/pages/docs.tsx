// 全局「文档」页 —— 跨项目汇总所有文档：搜索 + 分组（含「未归类」）+ 内嵌编辑。
// 文档可属 0..N 个项目：无项目=未归类，仍可直接在本页编辑；编辑器内可随时改所属项目。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { File01Icon, Add01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { listAllDocs, createDocRecord, deleteDocRecord } from "@/lib/pb/docs";
import { listProjects } from "@/lib/pb/board";
import { currentUserId } from "@/lib/pb";
import { openDocWindow } from "@/lib/tauri/window";
import type { BoardDoc } from "@/types/docs";
import type { BoardProject } from "@/types/board";

// 未归类分组的 key（空串）
const NONE = "";

function snippet(content: string, q: string): string {
  if (!content) return "";
  const flat = content.replace(/\s+/g, " ").trim();
  const i = q ? flat.toLowerCase().indexOf(q) : -1;
  if (i < 0) return flat.slice(0, 80);
  const start = Math.max(0, i - 24);
  return (start > 0 ? "…" : "") + flat.slice(start, start + 90) + "…";
}

export default function DocsPage() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<BoardDoc[]>([]);
  const [projects, setProjects] = useState<BoardProject[]>([]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  // 是否显示「仅属于已归档项目」的文档（默认隐藏，保持列表清爽；与看板「显示归档」一致）
  const [showArchived, setShowArchived] = useState(false);
  // 待确认删除的文档（受控 AlertDialog；避免 ContextMenu 内直接删的误触）
  const [pendingDelete, setPendingDelete] = useState<BoardDoc | null>(null);

  const reload = useCallback(() => {
    void listAllDocs().then(setDocs).catch(() => {});
    void listProjects().then(setProjects).catch(() => {});
  }, []);
  useEffect(() => reload(), [reload]);

  const projectName = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );
  // 已归档项目 id 集合
  const archivedSet = useMemo(
    () => new Set(projects.filter((p) => p.archived).map((p) => p.id)),
    [projects],
  );
  // 会被「隐藏归档」影响的文档数（仅属于归档项目的），用于开关显示与计数
  const hiddenCount = useMemo(
    () =>
      docs.filter(
        (d) => d.projects?.length && d.projects.every((p) => archivedSet.has(p)),
      ).length,
    [docs, archivedSet],
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? docs.filter(
            (d) =>
              (d.title || "").toLowerCase().includes(q) ||
              (d.content || "").toLowerCase().includes(q),
          )
        : docs,
    [docs, q],
  );

  const groups = useMemo(() => {
    const map = new Map<string, BoardDoc[]>();
    for (const d of filtered) {
      // 多对多：文档出现在其每个关联项目分组下；无项目 → 未归类（NONE）
      let pids = d.projects?.length ? d.projects : [NONE];
      if (!showArchived) {
        // 隐藏归档：丢弃归档项目的分组；若文档仅属归档项目 → 整条隐藏
        const kept = pids.filter((p) => p === NONE || !archivedSet.has(p));
        if (kept.length === 0) continue;
        pids = kept;
      }
      for (const pid of pids) {
        const arr = map.get(pid) ?? [];
        arr.push(d);
        map.set(pid, arr);
      }
    }
    for (const arr of map.values())
      arr.sort((a, b) => (b.updated > a.updated ? 1 : -1));
    // 未归类排最后
    return [...map.entries()].sort((a, b) =>
      a[0] === NONE ? 1 : b[0] === NONE ? -1 : 0,
    );
  }, [filtered, showArchived, archivedSet]);

  // 新建文档：默认无项目（未归类），创建后直接进全页编辑器；之后可在编辑器里挂到项目
  const createDoc = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const doc = await createDocRecord({
        owner: currentUserId(),
        projects: [],
        title: "未命名文档",
        content: "",
      });
      navigate(`/docs/${doc.id}`);
    } catch (e) {
      toast.error(`创建失败：${String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  const removeDoc = async (d: BoardDoc) => {
    try {
      await deleteDocRecord(d.id);
      setDocs((prev) => prev.filter((x) => x.id !== d.id));
    } catch (e) {
      toast.error(`删除失败：${String(e)}`);
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 p-6">
      <header className="flex shrink-0 items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">文档</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            跨项目汇总，搜索标题与正文。文档可不属任何项目（未归类），也可挂到一个或多个项目。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* 显示/隐藏「仅属于归档项目」的文档（有才出现） */}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              aria-pressed={showArchived}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {showArchived ? "隐藏归档项目文档" : `显示已归档项目文档（${hiddenCount}）`}
            </button>
          )}
          <Button size="sm" disabled={creating} onClick={() => void createDoc()}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            新建文档
          </Button>
        </div>
      </header>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索文档（标题 + 正文）…"
        className="shrink-0"
      />

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {docs.length === 0
              ? "暂无文档，点右上「新建文档」开始"
              : !q && !showArchived && hiddenCount > 0
                ? `已隐藏 ${hiddenCount} 篇归档项目的文档，点右上「显示已归档项目文档」查看`
                : "没有匹配的文档"}
          </p>
        ) : (
          groups.map(([projectId, list]) => (
            <section key={projectId || "__none__"}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {projectId === NONE
                  ? "未归类"
                  : (projectName.get(projectId) ?? "未知项目")}
                （{list.length}）
              </h2>
              <div className="flex flex-col gap-1.5">
                {list.map((d) => (
                  <ContextMenu key={d.id}>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        onClick={() => navigate(`/docs/${d.id}`)}
                        className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40"
                      >
                        <HugeiconsIcon
                          icon={File01Icon}
                          strokeWidth={2}
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {d.title || "未命名文档"}
                          </span>
                          {d.content && (
                            <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                              {snippet(d.content, q)}
                            </span>
                          )}
                        </span>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onSelect={() => navigate(`/docs/${d.id}`)}>
                        编辑
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => void openDocWindow(d.id, d.title)}>
                        在新窗口打开
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem variant="destructive" onSelect={() => setPendingDelete(d)}>
                        删除
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {/* 删除确认（受控） */}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除此文档？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.title || "未命名文档"}」将被永久删除，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) void removeDoc(pendingDelete);
                setPendingDelete(null);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
