// ImportPlanDialog —— 从计划目录选计划 → 解析建卡；可选把同名 spec 存为文档。
// 目录不写死：兼容 superpowers 官方(docs/superpowers/plans)+ 旧版(docs/plans)，递归子目录，
// 还可手选任意目录（其它 agent/plugin 的计划位置）。
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
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
  parseTaskmasterTasks,
  parseDocTitle,
  specNameForPlan,
  type PlanTask,
} from "./plan-import";

// Taskmaster 的 tasks.json（JSON，目录扫描列不到，单独探测）
const TASKMASTER_JSON = ".taskmaster/tasks/tasks.json";
import type { BoardProject } from "@/types/board";

// 全网主流规格驱动工具的计划/规格目录（相对仓库根）。递归由 Rust 侧负责，能进 <feature>/ 子目录。
// superpowers(docs/superpowers|docs/plans) + GitHub Spec Kit(specs/) + Kiro(.kiro/specs/)。
// Taskmaster(.taskmaster, JSON/.txt) 与 BMAD(docs/ 散文故事) 不适合卡片解析，靠「选择其它目录」兜底。
const PLAN_DIRS = [
  "docs/superpowers/plans",
  "docs/plans",
  "plans",
  "specs", // GitHub Spec Kit: specs/<NNN-feature>/tasks.md
  ".kiro/specs", // Kiro: .kiro/specs/<feature>/tasks.md
];
const SPEC_DIRS = [
  "docs/superpowers/specs",
  "docs/specs",
  "specs",
  ".kiro/specs",
];
// 拼接子路径（去掉尾部分隔符再补 /）
const joinPath = (a: string, b: string) => `${a.replace(/[\\/]$/, "")}/${b}`;

// 扫描一组子目录（相对 repo）下的所有 .md，聚合去重（按 path）。
async function scanDirs(repo: string, subdirs: string[]): Promise<MdFile[]> {
  const lists = await Promise.all(
    subdirs.map((s) =>
      ipc.listMarkdownFiles(joinPath(repo, s)).catch(() => [] as MdFile[]),
    ),
  );
  const map = new Map<string, MdFile>();
  for (const list of lists) for (const f of list) map.set(f.path, f);
  return [...map.values()];
}

// 合并新文件到已有列表（按 path 去重）。
function mergeFiles(prev: MdFile[], add: MdFile[]): MdFile[] {
  const map = new Map(prev.map((f) => [f.path, f]));
  for (const f of add) map.set(f.path, f);
  return [...map.values()];
}

export function ImportPlanDialog({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project: BoardProject;
}) {
  const { t } = useTranslation("board");
  const importPlanTasks = useBoardStore((s) => s.importPlanTasks);
  const repo = project.repo_path ?? "";
  const [files, setFiles] = useState<MdFile[]>([]);
  const [sel, setSel] = useState<MdFile | null>(null);
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [withSpec, setWithSpec] = useState(true);
  // 匹配到的同名 spec 文件（存整条以拿 path，spec 可能在任意 SPEC_DIRS 里）
  const [specFile, setSpecFile] = useState<MdFile | null>(null);
  const [busy, setBusy] = useState(false);

  // 仓库根相对显示（区分不同目录/子目录里的同名文件）
  const relLabel = (p: string) => {
    const norm = p.replace(/\\/g, "/");
    const r = repo.replace(/\\/g, "/").replace(/\/$/, "");
    return r && norm.toLowerCase().startsWith(r.toLowerCase() + "/")
      ? norm.slice(r.length + 1)
      : norm;
  };

  // 打开时扫计划目录（递归）+ 探测 Taskmaster 的 tasks.json（JSON，扫描列不到）
  useEffect(() => {
    if (!open || !repo) return;
    setSel(null);
    setTasks([]);
    void (async () => {
      const md = await scanDirs(repo, PLAN_DIRS).catch(() => [] as MdFile[]);
      const tmPath = joinPath(repo, TASKMASTER_JSON);
      let extra: MdFile[] = [];
      try {
        await ipc.readTextFile(tmPath); // 读成功=存在
        extra = [{ name: "tasks.json", path: tmPath }];
      } catch {
        /* 无 Taskmaster */
      }
      setFiles(mergeFiles(md, extra));
    })();
  }, [open, repo]);

  // 手选任意目录（其它 agent/plugin 的计划位置）
  const pickDir = async () => {
    try {
      const dir = await openDialog({ directory: true, title: t("importPlan.pickDirTitle") });
      if (typeof dir !== "string") return;
      const list = await ipc.listMarkdownFiles(dir).catch(() => [] as MdFile[]);
      if (list.length === 0) {
        toast.message(t("importPlan.toast.noPlanFiles"));
        return;
      }
      setFiles((prev) => mergeFiles(prev, list));
    } catch (e) {
      toast.error(t("importPlan.toast.pickDirError", { msg: String(e) }));
    }
  };

  // 选中计划 → 读+解析（.json 走 Taskmaster，.md 走通用）+ 探测同名 spec
  const pick = async (f: MdFile) => {
    setSel(f);
    try {
      const text = await ipc.readTextFile(f.path);
      const isJson = f.path.toLowerCase().endsWith(".json");
      setTasks(isJson ? parseTaskmasterTasks(text) : parsePlanTasks(text));
      if (isJson) {
        setSpecFile(null); // Taskmaster JSON 无同名 spec 概念
        return;
      }
      const specFiles = await scanDirs(repo, SPEC_DIRS).catch(() => [] as MdFile[]);
      setSpecFile(specFiles.find((s) => s.name === specNameForPlan(f.name)) ?? null);
    } catch (e) {
      toast.error(t("importPlan.toast.readError", { msg: String(e) }));
      setTasks([]);
    }
  };

  const doImport = async () => {
    if (!sel || tasks.length === 0 || busy) return;
    setBusy(true);
    try {
      const { created, skipped } = await importPlanTasks(tasks, sel.name);
      let docMsg = "";
      if (withSpec && specFile) {
        try {
          const md = await ipc.readTextFile(specFile.path);
          await createDocRecord({
            owner: currentUserId(),
            projects: [project.id],
            title: parseDocTitle(md) || specNameForPlan(sel.name),
            content: md,
          });
          docMsg = t("importPlan.toast.specSaved");
        } catch (e) {
          docMsg = t("importPlan.toast.specError", { msg: String(e) });
        }
      }
      toast.success(t("importPlan.toast.importSuccess", { created, skipped, docMsg }));
      onClose();
    } catch (e) {
      toast.error(t("importPlan.toast.importError", { msg: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{t("importPlan.title")}</DialogTitle>
          <DialogDescription>
            {t("importPlan.desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {t("importPlan.fileCount", { count: files.length })}
          </span>
          <Button variant="outline" size="xs" onClick={() => void pickDir()}>
            {t("importPlan.pickDir")}
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-1">
          {files.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("importPlan.empty")}
            </p>
          ) : (
            files.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => void pick(f)}
                title={f.path}
                className={`block w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  sel?.path === f.path
                    ? "border-primary bg-accent"
                    : "border-border bg-card hover:bg-accent"
                }`}
              >
                <span className="truncate font-mono text-foreground">{relLabel(f.path)}</span>
                {sel?.path === f.path && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t("importPlan.parsedCount", { count: tasks.length })}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {sel && specFile && (
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={withSpec}
              onChange={(e) => setWithSpec(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            {t("importPlan.withSpec", { name: specNameForPlan(sel.name) })}
          </label>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common:action.cancel")}
          </Button>
          <Button
            onClick={() => void doImport()}
            disabled={busy || !sel || tasks.length === 0}
          >
            {busy ? t("importPlan.importing") : t("importPlan.importBtn", { count: tasks.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
