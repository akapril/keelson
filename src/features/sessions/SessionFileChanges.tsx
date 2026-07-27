// SessionFileChanges —— 会话→文件改动溯源：展示本会话改动了哪些文件、改了什么。
// 数据从会话转录里的 Write/Edit/MultiEdit 工具调用还原（Rust session_file_changes），
// 含未提交 git 的改动，补齐「此会话期间的提交」看不到的部分。v1 仅 Claude。
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { diffLines } from "diff";
import { HugeiconsIcon } from "@hugeicons/react";
import { File01Icon, ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { ipc } from "@/lib/tauri/ipc";
import { cn } from "@/lib/utils";
import type { FileChange, FileEdit } from "@/types/file-change";
import type { Session } from "@/types/session";

/** 把绝对路径显示为相对项目根的短路径（无法相对时回退basename/原串）。 */
function shortPath(path: string, root: string): string {
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "");
  const p = norm(path);
  const r = norm(root);
  if (r && p.toLowerCase().startsWith(r.toLowerCase() + "/")) return p.slice(r.length + 1);
  return p;
}

/** 单次改动的 diff（Edit/MultiEdit：old→new 行级 diff；Write：整段视为新增）。 */
function EditDiff({ edit }: { edit: FileEdit }) {
  const parts = useMemo(() => {
    if (edit.tool === "Write") {
      return [{ added: true, removed: false, value: edit.new }];
    }
    return diffLines(edit.old, edit.new);
  }, [edit]);
  return (
    <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-muted/40 p-2 text-[11px] leading-relaxed">
      {parts.map((part, i) => (
        <span
          key={i}
          className={cn(
            "block whitespace-pre-wrap",
            part.added && "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
            part.removed && "bg-red-500/15 text-red-800 line-through dark:text-red-300",
            !part.added && !part.removed && "text-muted-foreground",
          )}
        >
          {part.value.replace(/\n$/, "")}
        </span>
      ))}
    </pre>
  );
}

export function SessionFileChanges({
  session,
  open,
  onCount,
}: {
  session: Session;
  open: boolean;
  onCount: (n: number) => void;
}) {
  const { t } = useTranslation("sessions");
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [openFile, setOpenFile] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setOpenFile(null);
    ipc
      .sessionFileChanges(session.provider, session.session_id)
      .then((list) => {
        if (cancelled) return;
        setChanges(list);
        onCount(list.length);
      })
      .catch(() => {
        if (!cancelled) {
          setChanges([]);
          onCount(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // onCount 是父级 setState 包装，排除以免刷新循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.session_id, session.provider]);

  if (!open) return null;
  if (loading) {
    return (
      <p className="mt-2 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <HugeiconsIcon icon={File01Icon} strokeWidth={2} className="size-3.5 animate-pulse" />
        {t("fileChanges.loading")}
      </p>
    );
  }
  if (changes.length === 0) {
    return <p className="mt-2 px-1 text-xs text-muted-foreground">{t("fileChanges.empty")}</p>;
  }

  return (
    <div className="mt-2">
      <div className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
        {changes.map((fc) => {
          const isOpen = openFile === fc.path;
          return (
            <div key={fc.path} className="rounded-lg border border-border bg-card">
              <button
                type="button"
                onClick={() => setOpenFile(isOpen ? null : fc.path)}
                className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs"
                title={fc.path}
              >
                <HugeiconsIcon
                  icon={isOpen ? ArrowDown01Icon : ArrowRight01Icon}
                  strokeWidth={2}
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                  {shortPath(fc.path, session.project_path)}
                </span>
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {t("fileChanges.editsCount", { n: fc.edits.length })}
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-border px-2.5 py-2">
                  {fc.edits.map((edit, i) => (
                    <div key={i} className="mb-2 last:mb-0">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {edit.tool}
                      </span>
                      <EditDiff edit={edit} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
