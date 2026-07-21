// 跨项目文档编辑弹窗：在全局「文档」页直接编辑任意文档（含无项目的游离档）。
// 标题 + Milkdown 编辑器 + 所属项目多选（可挂 0..N 个项目）；改动防抖自动保存。
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { HugeiconsIcon } from "@hugeicons/react";
import { FolderOpenIcon } from "@hugeicons/core-free-icons";
import {
  MilkdownDocumentEditor,
  type DocumentEditorMode,
} from "./MilkdownDocumentEditor";
import { updateDocRecord } from "@/lib/pb/docs";
import type { BoardDoc } from "@/types/docs";
import type { BoardProject } from "@/types/board";

export function DocEditorDialog({
  doc,
  projects,
  onClose,
  onSaved,
}: {
  doc: BoardDoc;
  projects: BoardProject[];
  onClose: () => void;
  /** 保存后回调，供列表页刷新对应条目 */
  onSaved: (updated: BoardDoc) => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [content, setContent] = useState(doc.content);
  const [projectIds, setProjectIds] = useState<string[]>(doc.projects ?? []);
  const [mode, setMode] = useState<DocumentEditorMode>("rich-text");
  // 最近已保存值（避免自动保存把「刚保存的结果」再当作变更循环触发）
  const savedRef = useRef({ title: doc.title, content: doc.content });

  // 标题/正文防抖自动保存（700ms）
  useEffect(() => {
    if (title === savedRef.current.title && content === savedRef.current.content) return;
    const t = setTimeout(() => {
      void updateDocRecord(doc.id, { title: title.trim() || "未命名文档", content })
        .then((updated) => {
          savedRef.current = { title: updated.title, content: updated.content };
          onSaved(updated);
        })
        .catch((e) => toast.error(`保存失败：${String(e)}`));
    }, 700);
    return () => clearTimeout(t);
  }, [title, content, doc.id, onSaved]);

  // 切换文档与某项目的链接（可挂多个、也可全解绑变游离档）
  const toggleProject = (pid: string) => {
    const next = projectIds.includes(pid)
      ? projectIds.filter((p) => p !== pid)
      : [...projectIds, pid];
    setProjectIds(next);
    void updateDocRecord(doc.id, { projects: next })
      .then(onSaved)
      .catch((e) => toast.error(`更新归属失败：${String(e)}`));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[85vh] w-full max-w-4xl flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="sr-only">编辑文档</DialogTitle>
          <div className="flex items-center gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="文档标题"
              className="h-9 flex-1 border-0 bg-transparent px-1 text-base font-semibold shadow-none focus-visible:ring-0"
            />
            {/* 所属项目（0..N） */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground">
                  <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
                  {projectIds.length === 0 ? "未归类" : `${projectIds.length} 个项目`}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
                <DropdownMenuLabel>链接到项目（可不选=未归类）</DropdownMenuLabel>
                {projects.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">暂无项目</p>
                ) : (
                  projects.map((p) => (
                    <DropdownMenuCheckboxItem
                      key={p.id}
                      checked={projectIds.includes(p.id)}
                      onSelect={(e) => e.preventDefault()}
                      onCheckedChange={() => toggleProject(p.id)}
                    >
                      <span className="truncate">{p.name}</span>
                    </DropdownMenuCheckboxItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </DialogHeader>

        {/* 编辑器（flex 列容器保证内部可滚动） */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">
          <MilkdownDocumentEditor
            key={doc.id}
            value={content}
            savedValue={savedRef.current.content}
            mode={mode}
            onModeChange={setMode}
            onChange={setContent}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
