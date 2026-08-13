// TaskBreakdownDialog —— 任务 AI 拆解：把一个任务拆成 3-6 个可执行子任务，
// 勾选后在同项目同状态列创建（看板无父子字段，作为兄弟任务，描述标注来源任务）。
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ipc } from "@/lib/tauri/ipc";
import { useSettingsStore } from "@/store/settings";
import { useBoardStore } from "@/store/board";
import { parseCandidates, type TaskCandidate } from "@/features/chemistry/extract";
import type { BoardTask } from "@/types/board";

const SYSTEM = `把用户给定的任务拆解为 3-6 个可执行的子任务。只输出严格 JSON（不要解释、不要围栏）：
{"tasks":[{"title":"子任务标题","description":"可选","priority":"none|low|medium|high|urgent"}],"docs":[]}
子任务标题要简洁、动词开头、可独立完成。`;

type Phase = "loading" | "review" | "committing" | "error";

export function TaskBreakdownDialog({
  task,
  onClose,
  onCreated,
}: {
  task: BoardTask | null;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const { t } = useTranslation("board");
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [subs, setSubs] = useState<TaskCandidate[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!task) return;
    let cancelled = false;
    setPhase("loading");
    setError(null);
    void (async () => {
      const cfg = useSettingsStore.getState().aiConfig;
      if (!cfg.api_key) {
        if (!cancelled) {
          setError(t("breakdown.noApiKey"));
          setPhase("error");
        }
        return;
      }
      try {
        const reply = await ipc.aiChat(cfg, [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `任务标题：${task.title}\n任务描述：${task.description ?? "（无）"}`,
          },
        ]);
        if (cancelled) return;
        const tasks = parseCandidates(reply).tasks;
        setSubs(tasks);
        setSel(new Set(tasks.map((_, i) => i)));
        setPhase("review");
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  const toggle = (i: number) => {
    const n = new Set(sel);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    setSel(n);
  };

  const commit = async () => {
    if (!task || sel.size === 0) return;
    setPhase("committing");
    setError(null);
    try {
      const chosen = [...sel].map((i) => subs[i]);
      for (const sub of chosen) {
        const desc = [sub.description?.trim(), t("breakdown.sourceRef", { title: task.title })]
          .filter(Boolean)
          .join("\n");
        await useBoardStore.getState().createTask({
          project: task.project,
          state: task.state,
          title: sub.title,
          description: desc,
          priority: sub.priority,
        });
      }
      toast.success(t("breakdown.toast.created", { count: chosen.length }));
      onCreated?.();
      onClose();
    } catch (e) {
      setError(String(e));
      setPhase("review");
    }
  };

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && phase !== "committing" && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{t("breakdown.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("breakdown.dialogDesc")}
          </DialogDescription>
        </DialogHeader>

        {phase === "loading" && (
          <div className="py-10 text-center text-sm text-muted-foreground">{t("breakdown.loading")}</div>
        )}
        {phase === "error" && (
          <div className="py-10 text-center text-sm text-destructive">{error}</div>
        )}

        {(phase === "review" || phase === "committing") && (
          <>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto py-1">
              {subs.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t("breakdown.empty")}
                </p>
              ) : (
                subs.map((s, i) => (
                  <label
                    key={i}
                    className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-card p-2.5 text-sm"
                  >
                    <Checkbox
                      checked={sel.has(i)}
                      onCheckedChange={() => toggle(i)}
                      className="mt-0.5 size-3.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-foreground">{s.title}</span>
                      {s.priority !== "none" && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground">
                          [{s.priority}]
                        </span>
                      )}
                      {s.description && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {s.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))
              )}
            </div>
            {error && <p className="shrink-0 text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={phase === "committing"}>
                {t("common:action.cancel")}
              </Button>
              <Button
                onClick={() => void commit()}
                disabled={phase === "committing" || sel.size === 0}
              >
                {phase === "committing" ? t("breakdown.creating") : t("breakdown.createBtn", { count: sel.size })}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
