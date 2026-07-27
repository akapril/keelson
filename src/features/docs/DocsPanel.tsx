// DocsPanel —— 项目工作台「文档」标签：本项目文档列表。点开即跳全页编辑器 /docs/:id
// （与全局 /docs 统一同一套专业写作体验：斜杠菜单 / KaTeX / AI / 大纲 TOC）。
// 保留：新建（挂当前项目）、从文档建任务、删除。标题/正文/所属项目编辑均在全页完成。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("board");
  const { t: tCommon } = useTranslation("common");
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
      const doc = await useDocsStore.getState().createDoc(projectId, t("docsPanel.fallbackTitle"));
      navigate(`/docs/${doc.id}`);
    } catch (e) {
      toast.error(t("docsPanel.toast.createError", { msg: String(e) }));
    }
  }

  async function handleDelete(id: string) {
    try {
      await useDocsStore.getState().deleteDoc(id);
    } catch (e) {
      toast.error(t("docsPanel.toast.deleteError", { msg: String(e) }));
    }
  }

  // 从文档创建看板任务（同项目；工作台已打开该项目，状态列已加载）
  async function handleCreateTask(doc: BoardDoc) {
    const first = useBoardStore.getState().states[0];
    if (!first) {
      toast.error(t("docsPanel.toast.noStates"));
      return;
    }
    try {
      await useBoardStore.getState().createTask({
        project: projectId,
        state: first.id,
        title: doc.title || t("docsPanel.fallbackTitle"),
        description: doc.content.slice(0, 500) || undefined,
      });
      toast.success(t("docsPanel.toast.createTaskSuccess"));
    } catch (e) {
      toast.error(t("docsPanel.toast.createTaskError", { msg: String(e) }));
    }
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t("docsPanel.count", { count: docs.length })}
        </span>
        <Button size="sm" variant="outline" onClick={() => void handleCreate()}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          {tCommon("action.create")}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {loading && docs.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t("docsPanel.loading")}</p>
        ) : docs.length === 0 ? (
          <button
            type="button"
            onClick={() => void handleCreate()}
            className="rounded-xl border border-dashed py-10 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            + {tCommon("action.create")}
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
                      {doc.title || t("docsPanel.fallbackTitle")}
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
                  {tCommon("action.edit")}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void openDocWindow(doc.id, doc.title)}>
                  在新窗口打开
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void handleCreateTask(doc)}>
                  从文档建任务
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onSelect={() => setPendingDelete(doc)}>
                  {tCommon("action.delete")}
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
            <AlertDialogTitle>{t("docsPanel.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("docsPanel.confirmDeleteDesc", { title: pendingDelete?.title || t("docsPanel.fallbackTitle") })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("docsPanel.confirmDeleteCancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) void handleDelete(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              {tCommon("action.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
