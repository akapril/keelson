// DocsPanel —— 项目工作台「文档」标签：本项目文档列表。点开即跳全页编辑器 /docs/:id
// （与全局 /docs 统一同一套专业写作体验：斜杠菜单 / KaTeX / AI / 大纲 TOC）。
// 保留：新建（挂当前项目）、从文档建任务、删除。标题/正文/所属项目编辑均在全页完成。
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, File01Icon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { useDocsStore } from "@/store/docs";
import { useBoardStore } from "@/store/board";
import { openDocWindow } from "@/lib/tauri/window";
import type { BoardDoc } from "@/types/docs";

export function DocsPanel({
  projectId,
  initialDocId,
}: {
  projectId: string;
  /** 深链接定位的文档 id（来自 ⌘K 文档搜索）；加载后自动跳到全页编辑器。 */
  initialDocId?: string;
}) {
  const navigate = useNavigate();
  const docs = useDocsStore((s) => s.docs);
  const loading = useDocsStore((s) => s.loading);
  // 待确认删除的文档（受控 AlertDialog）
  const [pendingDelete, setPendingDelete] = useState<BoardDoc | null>(null);

  // 打开项目文档：加载列表 + 订阅；卸载/切项目时清理。
  useEffect(() => {
    void useDocsStore.getState().loadDocs(projectId);
    return () => useDocsStore.getState().closeDocs();
  }, [projectId]);

  // 深链接：⌘K 文档搜索定位的文档，加载到列表后自动跳全页编辑器。
  useEffect(() => {
    if (initialDocId && docs.some((d) => d.id === initialDocId)) {
      navigate(`/docs/${initialDocId}`);
    }
  }, [initialDocId, docs, navigate]);

  async function handleCreate() {
    try {
      const doc = await useDocsStore.getState().createDoc(projectId, "未命名文档");
      navigate(`/docs/${doc.id}`);
    } catch (e) {
      toast.error(`创建失败：${String(e)}`);
    }
  }

  async function handleDelete(id: string) {
    try {
      await useDocsStore.getState().deleteDoc(id);
    } catch (e) {
      toast.error(`删除失败：${String(e)}`);
    }
  }

  // 从文档创建看板任务（同项目；工作台已打开该项目，状态列已加载）
  async function handleCreateTask(doc: BoardDoc) {
    const first = useBoardStore.getState().states[0];
    if (!first) {
      toast.error("该项目暂无状态列，无法创建任务");
      return;
    }
    try {
      await useBoardStore.getState().createTask({
        project: projectId,
        state: first.id,
        title: doc.title || "未命名文档",
        description: doc.content.slice(0, 500) || undefined,
      });
      toast.success("已从文档创建任务");
    } catch (e) {
      toast.error(`创建任务失败：${String(e)}`);
    }
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between">
        <span className="text-xs text-muted-foreground">{docs.length} 篇文档</span>
        <Button size="sm" variant="outline" onClick={() => void handleCreate()}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          新建文档
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {loading && docs.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p>
        ) : docs.length === 0 ? (
          <button
            type="button"
            onClick={() => void handleCreate()}
            className="rounded-xl border border-dashed py-10 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            + 新建第一篇文档
          </button>
        ) : (
          docs.map((doc) => (
            <ContextMenu key={doc.id}>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  onClick={() => navigate(`/docs/${doc.id}`)}
                  className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40"
                >
                  <HugeiconsIcon
                    icon={File01Icon}
                    strokeWidth={2}
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {doc.title || "未命名文档"}
                    </span>
                    {doc.content && (
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                        {doc.content.replace(/\s+/g, " ").trim().slice(0, 120)}
                      </span>
                    )}
                  </span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => navigate(`/docs/${doc.id}`)}>
                  打开
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void openDocWindow(doc.id, doc.title)}>
                  在新窗口打开
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void handleCreateTask(doc)}>
                  从文档建任务
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onSelect={() => setPendingDelete(doc)}>
                  删除
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
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
                if (pendingDelete) void handleDelete(pendingDelete.id);
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
