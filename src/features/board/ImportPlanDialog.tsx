// ImportPlanDialog —— 从 <repo>/docs/superpowers/plans 选计划 → 解析建卡；可选把同名 spec 存为文档。
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ipc, type MdFile } from "@/lib/tauri/ipc";
import { useBoardStore } from "@/store/board";
import { createDocRecord } from "@/lib/pb/docs";
import { currentUserId } from "@/lib/pb";
import {
  parsePlanTasks,
  parseDocTitle,
  specNameForPlan,
  type PlanTask,
} from "./plan-import";
import type { BoardProject } from "@/types/board";

const PLANS_SUBDIR = "docs/superpowers/plans";
const SPECS_SUBDIR = "docs/superpowers/specs";
// 拼接子路径（去掉尾部分隔符再补 /）
const joinPath = (a: string, b: string) => `${a.replace(/[\\/]$/, "")}/${b}`;

export function ImportPlanDialog({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project: BoardProject;
}) {
  const importPlanTasks = useBoardStore((s) => s.importPlanTasks);
  const repo = project.repo_path ?? "";
  const [files, setFiles] = useState<MdFile[]>([]);
  const [sel, setSel] = useState<MdFile | null>(null);
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [withSpec, setWithSpec] = useState(true);
  const [specExists, setSpecExists] = useState(false);
  const [busy, setBusy] = useState(false);

  // 打开时列计划文件
  useEffect(() => {
    if (!open || !repo) return;
    setSel(null);
    setTasks([]);
    ipc
      .listMarkdownFiles(joinPath(repo, PLANS_SUBDIR))
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [open, repo]);

  // 选中计划 → 读+解析 + 探测同名 spec
  const pick = async (f: MdFile) => {
    setSel(f);
    try {
      const md = await ipc.readTextFile(f.path);
      setTasks(parsePlanTasks(md));
      const specFiles = await ipc
        .listMarkdownFiles(joinPath(repo, SPECS_SUBDIR))
        .catch(() => [] as MdFile[]);
      setSpecExists(specFiles.some((s) => s.name === specNameForPlan(f.name)));
    } catch (e) {
      toast.error(`读取失败：${String(e)}`);
      setTasks([]);
    }
  };

  const doImport = async () => {
    if (!sel || tasks.length === 0 || busy) return;
    setBusy(true);
    try {
      const { created, skipped } = await importPlanTasks(tasks, sel.name);
      let docMsg = "";
      if (withSpec && specExists) {
        try {
          const specPath = joinPath(joinPath(repo, SPECS_SUBDIR), specNameForPlan(sel.name));
          const md = await ipc.readTextFile(specPath);
          await createDocRecord({
            owner: currentUserId(),
            project: project.id,
            title: parseDocTitle(md) || specNameForPlan(sel.name),
            content: md,
          });
          docMsg = "，spec 已存为文档";
        } catch (e) {
          docMsg = `，spec 存文档失败：${String(e)}`;
        }
      }
      toast.success(`新建 ${created} 张卡片，跳过 ${skipped} 张已存在${docMsg}`);
      onClose();
    } catch (e) {
      toast.error(`导入失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>导入计划到看板</DialogTitle>
          <DialogDescription>
            解析 <code className="font-mono">{PLANS_SUBDIR}</code> 下计划的 Task
            段落为卡片（幂等，已存在跳过）。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-1">
          {files.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              未找到计划文件（{PLANS_SUBDIR}）。
            </p>
          ) : (
            files.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => void pick(f)}
                className={`block w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  sel?.path === f.path
                    ? "border-primary bg-accent"
                    : "border-border bg-card hover:bg-accent"
                }`}
              >
                <span className="font-mono text-foreground">{f.name}</span>
                {sel?.path === f.path && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    解析出 {tasks.length} 个任务
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {sel && specExists && (
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={withSpec}
              onChange={(e) => setWithSpec(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            同时把设计 spec（{specNameForPlan(sel.name)}）存为项目文档
          </label>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            onClick={() => void doImport()}
            disabled={busy || !sel || tasks.length === 0}
          >
            {busy ? "导入中…" : `导入 ${tasks.length} 个任务`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
