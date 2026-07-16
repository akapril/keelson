// DistillDialog —— 化学反应沉淀：从会话「AI 提炼」候选任务/文档 → 勾选确认 → 写入 + 通知。
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ipc } from "@/lib/tauri/ipc";
import { useSettingsStore } from "@/store/settings";
import { useNotificationsStore } from "@/store/notifications";
import { listProjects, listStates, listTasks, createRecord } from "@/lib/pb/board";
import { createDocRecord } from "@/lib/pb/docs";
import { COL } from "@/lib/pb/collections";
import { currentUserId } from "@/lib/pb";
import { nextRank } from "@/store/board-rank";
import { workspaceRecordUrl } from "@/lib/workspace-navigation";
import type { BoardProject } from "@/types/board";
import type { Session } from "@/types/session";
import { EXTRACT_SYSTEM, buildContext, parseCandidates, type Candidates } from "./extract";

type Phase = "idle" | "loading" | "review" | "committing";

export function DistillDialog({
  session,
  onClose,
}: {
  session: Session | null;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cands, setCands] = useState<Candidates>({ tasks: [], docs: [] });
  const [taskSel, setTaskSel] = useState<Set<number>>(new Set());
  const [docSel, setDocSel] = useState<Set<number>>(new Set());
  const [projects, setProjects] = useState<BoardProject[]>([]);
  const [projectId, setProjectId] = useState<string>("");

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setPhase("loading");
    setError(null);
    setCands({ tasks: [], docs: [] });

    void (async () => {
      const cfg = useSettingsStore.getState().aiConfig;
      if (!cfg.api_key) {
        if (!cancelled) {
          setError("尚未配置 AI 服务（请在设置页填写 API Key）");
          setPhase("idle");
        }
        return;
      }
      try {
        const [tl, projs] = await Promise.all([
          ipc.sessionTimeline(session.provider, session.session_id),
          listProjects(),
        ]);
        if (cancelled) return;
        setProjects(projs);
        // 预选：repo_path 与本会话 project_path 匹配的项目，否则第一个
        const match = projs.find(
          (p) => p.repo_path && p.repo_path === session.project_path,
        );
        setProjectId(match?.id ?? projs[0]?.id ?? "");

        const reply = await ipc.aiChat(cfg, [
          { role: "system", content: EXTRACT_SYSTEM },
          { role: "user", content: buildContext(tl) || "（无会话内容）" },
        ]);
        if (cancelled) return;
        const parsed = parseCandidates(reply);
        setCands(parsed);
        setTaskSel(new Set(parsed.tasks.map((_, i) => i)));
        setDocSel(new Set(parsed.docs.map((_, i) => i)));
        setPhase("review");
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setPhase("idle");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.session_id]);

  const toggle = (
    set: Set<number>,
    setSet: (s: Set<number>) => void,
    i: number,
  ) => {
    const n = new Set(set);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    setSet(n);
  };

  const selectedCount = taskSel.size + docSel.size;
  const nothing = cands.tasks.length === 0 && cands.docs.length === 0;

  const commit = async () => {
    if (!session || !projectId || selectedCount === 0) return;
    setPhase("committing");
    setError(null);
    try {
      const owner = currentUserId();
      const chosenTasks = [...taskSel].map((i) => cands.tasks[i]);
      const chosenDocs = [...docSel].map((i) => cands.docs[i]);
      let createdTasks = 0;
      let createdDocs = 0;

      if (chosenTasks.length > 0) {
        const states = await listStates(projectId);
        const firstState = states[0];
        if (!firstState) throw new Error("目标项目暂无状态列，无法创建任务");
        const existing = await listTasks(projectId);
        const inState = existing.filter((t) => t.state === firstState.id);
        let maxRank: number | null = inState.length
          ? Math.max(...inState.map((t) => t.rank ?? 0))
          : null;
        for (const t of chosenTasks) {
          const rank = nextRank(maxRank);
          maxRank = rank;
          await createRecord(COL.boardTasks, {
            project: projectId,
            state: firstState.id,
            title: t.title,
            description: t.description ?? "",
            priority: t.priority,
            rank,
            created_by: owner,
            // 溯源回链
            source_session_id: session.session_id,
            source_provider: session.provider,
          });
          createdTasks++;
        }
      }

      for (const d of chosenDocs) {
        await createDocRecord({
          owner,
          project: projectId,
          title: d.title,
          content: d.content,
        });
        createdDocs++;
      }

      const projName = projects.find((p) => p.id === projectId)?.name ?? "项目";
      await useNotificationsStore.getState().add({
        title: `已从会话沉淀 ${createdTasks} 任务 · ${createdDocs} 文档`,
        body: `来源：${session.project_name}（${session.provider}）→ ${projName}`,
        kind: "success",
        source: "沉淀",
        link: workspaceRecordUrl("board", projectId),
      });
      toast.success(`已沉淀 ${createdTasks} 个任务、${createdDocs} 篇文档`);
      onClose();
    } catch (e) {
      setError(String(e));
      setPhase("review");
    }
  };

  return (
    <Dialog open={!!session} onOpenChange={(o) => !o && phase !== "committing" && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>AI 提炼沉淀</DialogTitle>
          <DialogDescription>
            从此会话提炼可留存的任务与文档，勾选后写入所选项目（任务带来源回链）。
          </DialogDescription>
        </DialogHeader>

        {(phase === "loading" || phase === "idle") && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            {phase === "loading" ? (
              <span>正在提炼会话内容…</span>
            ) : (
              <span className="text-destructive">{error ?? "无法提炼"}</span>
            )}
          </div>
        )}

        {(phase === "review" || phase === "committing") && (
          <>
            {/* 目标项目 */}
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-sm text-muted-foreground">写入项目</span>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="选择目标项目" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-1">
              {nothing && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  未发现可沉淀的内容。
                </p>
              )}

              {/* 候选任务 */}
              {cands.tasks.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                    候选任务（{taskSel.size}/{cands.tasks.length}）
                  </p>
                  <div className="space-y-1.5">
                    {cands.tasks.map((t, i) => (
                      <label
                        key={i}
                        className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-card p-2.5 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={taskSel.has(i)}
                          onChange={() => toggle(taskSel, setTaskSel, i)}
                          className="mt-0.5 size-3.5 rounded border-input accent-primary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-foreground">{t.title}</span>
                          {t.priority !== "none" && (
                            <span className="ml-1.5 text-[10px] text-muted-foreground">
                              [{t.priority}]
                            </span>
                          )}
                          {t.description && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {t.description}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* 候选文档 */}
              {cands.docs.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                    候选文档（{docSel.size}/{cands.docs.length}）
                  </p>
                  <div className="space-y-1.5">
                    {cands.docs.map((d, i) => (
                      <label
                        key={i}
                        className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-card p-2.5 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={docSel.has(i)}
                          onChange={() => toggle(docSel, setDocSel, i)}
                          className="mt-0.5 size-3.5 rounded border-input accent-primary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-foreground">{d.title}</span>
                          {d.content && (
                            <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                              {d.content}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {error && <p className="shrink-0 text-xs text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={phase === "committing"}>
                取消
              </Button>
              <Button
                onClick={() => void commit()}
                disabled={phase === "committing" || !projectId || selectedCount === 0}
              >
                {phase === "committing" ? "写入中…" : `沉淀 ${selectedCount} 项`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
