// 全局「文档」页 —— 跨项目汇总所有文档：搜索 + 分组 + 深链直达。
// 支持「新建速记」（写入速记 Inbox 项目）与右键「移动到项目 / 删除」，实现"先记后归"。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { File01Icon, Add01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  listAllDocs,
  createDocRecord,
  updateDocRecord,
  deleteDocRecord,
} from "@/lib/pb/docs";
import { listProjects, ensureInboxProject } from "@/lib/pb/board";
import { currentUserId } from "@/lib/pb";
import { workspaceRecordUrl } from "@/lib/workspace-navigation";
import type { BoardDoc } from "@/types/docs";
import type { BoardProject } from "@/types/board";

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
  // 移动到项目对话框
  const [movingDoc, setMovingDoc] = useState<BoardDoc | null>(null);
  const [moveTarget, setMoveTarget] = useState("");

  const reload = useCallback(() => {
    void listAllDocs().then(setDocs).catch(() => {});
    void listProjects().then(setProjects).catch(() => {});
  }, []);
  useEffect(() => reload(), [reload]);

  const projectName = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
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
      // 多对多：文档出现在其每个关联项目分组下；孤档（无项目）不在此展示
      for (const pid of d.projects ?? []) {
        const arr = map.get(pid) ?? [];
        arr.push(d);
        map.set(pid, arr);
      }
    }
    for (const arr of map.values())
      arr.sort((a, b) => (b.updated > a.updated ? 1 : -1));
    return [...map.entries()];
  }, [filtered]);

  const open = (d: BoardDoc) =>
    navigate(
      workspaceRecordUrl("board", d.projects[0] ?? "", { tab: "docs", doc: d.id }),
    );

  // 新建速记：写入「速记」Inbox 项目并跳到编辑器
  const createQuickNote = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const inbox = await ensureInboxProject();
      const doc = await createDocRecord({
        owner: currentUserId(),
        projects: [inbox.id],
        title: "未命名速记",
        content: "",
      });
      navigate(workspaceRecordUrl("board", inbox.id, { tab: "docs", doc: doc.id }));
    } catch (e) {
      toast.error(`创建失败：${String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  // 移动到项目
  const confirmMove = async () => {
    if (!movingDoc || !moveTarget) return;
    try {
      await updateDocRecord(movingDoc.id, { projects: [moveTarget] });
      toast.success("已移动");
      setMovingDoc(null);
      reload();
    } catch (e) {
      toast.error(`移动失败：${String(e)}`);
    }
  };

  const removeDoc = async (d: BoardDoc) => {
    try {
      await deleteDocRecord(d.id);
      reload();
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
            跨项目汇总，搜索标题与正文；速记先写入「速记」，之后可移动到项目。
          </p>
        </div>
        <Button size="sm" disabled={creating} onClick={() => void createQuickNote()}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          新建速记
        </Button>
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
            {docs.length === 0 ? "暂无文档，点右上「新建速记」开始" : "没有匹配的文档"}
          </p>
        ) : (
          groups.map(([projectId, list]) => (
            <section key={projectId}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {projectName.get(projectId) ?? "未知项目"}（{list.length}）
              </h2>
              <div className="flex flex-col gap-1.5">
                {list.map((d) => (
                  <ContextMenu key={d.id}>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        onClick={() => open(d)}
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
                      <ContextMenuItem onSelect={() => open(d)}>打开</ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => {
                          setMoveTarget("");
                          setMovingDoc(d);
                        }}
                      >
                        移动到项目
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem variant="destructive" onSelect={() => void removeDoc(d)}>
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

      {/* 移动到项目对话框 */}
      <Dialog open={!!movingDoc} onOpenChange={(o) => !o && setMovingDoc(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>移动文档到项目</DialogTitle>
            <DialogDescription>
              «{movingDoc?.title || "未命名文档"}» 将归属到所选项目。
            </DialogDescription>
          </DialogHeader>
          <Select value={moveTarget} onValueChange={setMoveTarget}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择目标项目" />
            </SelectTrigger>
            <SelectContent>
              {projects
                .filter((p) => !movingDoc?.projects?.includes(p.id))
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovingDoc(null)}>
              取消
            </Button>
            <Button disabled={!moveTarget} onClick={() => void confirmMove()}>
              移动
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
