// DocsPanel —— 项目工作台「文档」标签内容：左侧文档列表 + 右侧 Milkdown 编辑器。
// 文档按 project 归属（board_projects），自动保存（防抖 800ms）。
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Delete02Icon,
  TaskAdd01Icon,
  FolderOpenIcon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";

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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useDocsStore } from "@/store/docs";
import { useBoardStore } from "@/store/board";
import {
  MilkdownDocumentEditor,
  type DocumentEditorMode,
} from "./MilkdownDocumentEditor";

export function DocsPanel({
  projectId,
  initialDocId,
}: {
  projectId: string;
  /** 深链接定位的文档 id（来自 ⌘K 文档搜索）；加载后自动选中。 */
  initialDocId?: string;
}) {
  const docs = useDocsStore((s) => s.docs);
  const loading = useDocsStore((s) => s.loading);
  const allProjects = useBoardStore((s) => s.projects);

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

  // 深链接：⌘K 文档搜索定位的文档，加载后自动选中（存在才切换，覆盖默认选中）。
  useEffect(() => {
    if (initialDocId && docs.some((d) => d.id === initialDocId)) {
      setSelectedId(initialDocId);
    }
  }, [initialDocId, docs]);

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

  // 切换文档与某项目的链接（多对多）：加入/移除 projects
  function toggleDocProject(projId: string) {
    if (!selected) return;
    const cur = selected.projects ?? [];
    const next = cur.includes(projId)
      ? cur.filter((p) => p !== projId)
      : [...cur, projId];
    void useDocsStore.getState().updateDoc(selected.id, { projects: next });
  }

  // 从当前文档创建看板任务（同项目；工作台已打开该项目，状态列已加载）
  async function handleCreateTask() {
    if (!selected) return;
    const first = useBoardStore.getState().states[0];
    if (!first) {
      toast.error("该项目暂无状态列，无法创建任务");
      return;
    }
    try {
      await useBoardStore.getState().createTask({
        project: projectId,
        state: first.id,
        title: selected.title || "未命名文档",
        description: content.slice(0, 500) || undefined,
      });
      toast.success("已从文档创建任务");
    } catch (e) {
      toast.error(`创建任务失败：${String(e)}`);
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
              {/* 所属项目（多对多）：可链接到多个项目 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground">
                    <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
                    {selected.projects?.length ?? 0} 个项目
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
                  <DropdownMenuLabel>链接到项目</DropdownMenuLabel>
                  {allProjects.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">暂无项目</p>
                  ) : (
                    allProjects.map((p) => (
                      <DropdownMenuCheckboxItem
                        key={p.id}
                        checked={selected.projects?.includes(p.id) ?? false}
                        // 阻止选中即关闭菜单，便于连续勾选多个
                        onSelect={(e) => e.preventDefault()}
                        onCheckedChange={() => toggleDocProject(p.id)}
                      >
                        <span className="truncate">{p.name}</span>
                      </DropdownMenuCheckboxItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="从文档建任务"
                title="从此文档创建看板任务"
                onClick={() => void handleCreateTask()}
                className="text-muted-foreground hover:text-primary"
              >
                <HugeiconsIcon icon={TaskAdd01Icon} strokeWidth={2} />
              </Button>
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

            {/* Milkdown 编辑器（rich-text / source / diff）。
                外层必须是 flex 列容器：否则内部 .rework-milkdown-editor 的 flex:1 失效，
                编辑器按内容撑高、溢出被 overflow-hidden 裁掉而无法滚动（修长文档不能下滑）。 */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">
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
