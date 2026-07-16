// DocsPanel —— 项目工作台「文档」标签内容：左侧文档列表 + 右侧 Milkdown 编辑器。
// 文档按 project 归属（board_projects），自动保存（防抖 800ms）。
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useDocsStore } from "@/store/docs";
import {
  MilkdownDocumentEditor,
  type DocumentEditorMode,
} from "./MilkdownDocumentEditor";

export function DocsPanel({ projectId }: { projectId: string }) {
  const docs = useDocsStore((s) => s.docs);
  const loading = useDocsStore((s) => s.loading);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<DocumentEditorMode>("rich-text");

  // 打开项目文档：加载列表 + 订阅；卸载/切项目时清理。
  useEffect(() => {
    void useDocsStore.getState().loadDocs(projectId);
    return () => useDocsStore.getState().closeDocs();
  }, [projectId]);

  const selected = docs.find((d) => d.id === selectedId) ?? null;

  // 首次有文档且未选中时，默认选中第一篇。
  useEffect(() => {
    if (!selectedId && docs.length > 0) setSelectedId(docs[0].id);
  }, [docs, selectedId]);

  // 切换选中文档时，把其正文载入编辑器本地状态。
  useEffect(() => {
    const doc = docs.find((d) => d.id === selectedId);
    setContent(doc ? doc.content : "");
    // 仅在选中项变化时重置编辑器内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // 自动保存：正文与已保存值不同则防抖写回。
  useEffect(() => {
    if (!selected) return;
    if (content === selected.content) return;
    const timer = setTimeout(() => {
      void useDocsStore.getState().updateDoc(selected.id, { content });
    }, 800);
    return () => clearTimeout(timer);
  }, [content, selected]);

  async function handleCreate() {
    const doc = await useDocsStore.getState().createDoc(projectId, "未命名文档");
    setSelectedId(doc.id);
  }

  async function handleDelete(id: string) {
    await useDocsStore.getState().deleteDoc(id);
    if (selectedId === id) setSelectedId(null);
  }

  function handleTitleBlur(title: string) {
    if (selected && title.trim() && title.trim() !== selected.title) {
      void useDocsStore.getState().updateDoc(selected.id, { title: title.trim() });
    }
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* 左：文档列表 */}
      <div className="flex w-60 shrink-0 flex-col gap-2">
        <div className="flex shrink-0 items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {docs.length} 篇文档
          </span>
          <Button size="xs" variant="outline" onClick={handleCreate}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            新建
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {loading && docs.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              加载中…
            </p>
          ) : docs.length === 0 ? (
            <button
              type="button"
              onClick={handleCreate}
              className="rounded-lg border border-dashed py-6 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              + 新建第一篇文档
            </button>
          ) : (
            docs.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => setSelectedId(doc.id)}
                className={cn(
                  "flex items-center justify-between gap-1 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-sm transition-colors",
                  doc.id === selectedId
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/50",
                )}
              >
                <span className="truncate">{doc.title || "未命名文档"}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 右：编辑器 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {selected ? (
          <>
            <div className="flex shrink-0 items-center gap-2">
              <Input
                key={selected.id}
                defaultValue={selected.title}
                onBlur={(e) => handleTitleBlur(e.target.value)}
                placeholder="文档标题"
                className="h-8 flex-1 border-0 bg-transparent px-1 text-base font-semibold shadow-none focus-visible:ring-0"
              />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="删除文档"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>删除此文档？</AlertDialogTitle>
                    <AlertDialogDescription>
                      「{selected.title || "未命名文档"}」将被永久删除，无法恢复。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => void handleDelete(selected.id)}
                    >
                      删除
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            {/* Milkdown 编辑器（rich-text / source / diff） */}
            <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border">
              <MilkdownDocumentEditor
                key={selected.id}
                value={content}
                savedValue={selected.content}
                mode={mode}
                onModeChange={setMode}
                onChange={setContent}
              />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            选择或新建一篇文档开始编辑。
          </div>
        )}
      </div>
    </div>
  );
}
