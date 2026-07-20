// MemoryReviewDialog —— 从会话提炼记忆：AI 出候选 → 去重分类 → 勾选确认 → 写 memories。
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
import { ipc } from "@/lib/tauri/ipc";
import { useSettingsStore } from "@/store/settings";
import { currentUserId } from "@/lib/pb";
import { listMemories, createMemoryRecord } from "@/lib/pb/memory";
import { buildContext } from "@/features/chemistry/extract";
import {
  MEMORY_EXTRACT_SYSTEM,
  parseMemories,
  classifyCandidates,
  type ClassifiedCandidate,
} from "./extract";
import { MEMORY_KIND_LABEL, type Memory } from "@/types/memory";
import type { Session } from "@/types/session";

type Phase = "loading" | "idle" | "review" | "committing";

export function MemoryReviewDialog({
  session,
  onClose,
}: {
  session: Session | null;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ClassifiedCandidate[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setPhase("loading");
    setError(null);
    setItems([]);

    void (async () => {
      const cfg = useSettingsStore.getState().aiConfig;
      const isCli = cfg.provider === "claude-cli" || cfg.provider === "codex-cli";
      if (!isCli && !cfg.api_key) {
        if (!cancelled) {
          setError("尚未配置 AI 服务（请在设置页填写 API Key，或改用本地 CLI provider）");
          setPhase("idle");
        }
        return;
      }
      try {
        const [tl, existing] = await Promise.all([
          ipc.sessionTimeline(session.provider, session.session_id),
          listMemories().catch(() => [] as Memory[]),
        ]);
        if (cancelled) return;
        const reply = await ipc.aiChat(cfg, [
          { role: "system", content: MEMORY_EXTRACT_SYSTEM },
          { role: "user", content: buildContext(tl) || "（无会话内容）" },
        ]);
        if (cancelled) return;
        const classified = classifyCandidates(parseMemories(reply), existing);
        setItems(classified);
        // 默认勾选全新记忆（duplicateOf === null）
        setSel(new Set(classified.map((c, i) => (c.duplicateOf === null ? i : -1)).filter((i) => i >= 0)));
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

  const toggle = (i: number) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const commit = async () => {
    if (!session || sel.size === 0) return;
    setPhase("committing");
    setError(null);
    try {
      const owner = currentUserId();
      const chosen = [...sel].map((i) => items[i].candidate);
      for (const c of chosen) {
        await createMemoryRecord({
          owner,
          content: c.content,
          kind: c.kind,
          scope: c.scope,
          confidence: c.confidence,
          project: "",
          source_session_id: session.session_id,
          source_provider: session.provider,
        });
      }
      toast.success(`已沉淀 ${chosen.length} 条记忆`);
      onClose();
    } catch (e) {
      setError(String(e));
      setPhase("review");
    }
  };

  const freshCount = items.filter((c) => c.duplicateOf === null).length;

  return (
    <Dialog open={!!session} onOpenChange={(o) => !o && phase !== "committing" && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>提炼记忆</DialogTitle>
          <DialogDescription>
            从此会话提炼可长期复用的事实/偏好/决策/约定；已有的自动标为重复。勾选后存入记忆账本（带来源）。
          </DialogDescription>
        </DialogHeader>

        {(phase === "loading" || phase === "idle") && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            {phase === "loading" ? <span>正在提炼记忆…</span> : <span className="text-destructive">{error ?? "无法提炼"}</span>}
          </div>
        )}

        {(phase === "review" || phase === "committing") && (
          <>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto py-1">
              {items.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">未发现可沉淀的记忆。</p>
              )}
              {items.map((c, i) => {
                const dup = c.duplicateOf !== null;
                return (
                  <label
                    key={i}
                    className={`flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2.5 text-sm ${
                      dup ? "bg-muted/40 opacity-70" : "bg-card"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={sel.has(i)}
                      onChange={() => toggle(i)}
                      className="mt-0.5 size-3.5 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground">{c.candidate.content}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="rounded bg-muted px-1">{MEMORY_KIND_LABEL[c.candidate.kind]}</span>
                        <span className="rounded bg-muted px-1">{c.candidate.scope === "global" ? "全局" : "项目"}</span>
                        <span>把握 {c.candidate.confidence}</span>
                        {dup && (
                          <span className="text-amber-600 dark:text-amber-400">
                            {c.duplicateOf ? "已有类似记忆" : "本批重复"}
                          </span>
                        )}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            {error && <p className="shrink-0 text-xs text-destructive">{error}</p>}

            <DialogFooter className="items-center">
              <span className="mr-auto text-xs text-muted-foreground">
                {freshCount} 条新 · 已选 {sel.size}
              </span>
              <Button variant="outline" onClick={onClose} disabled={phase === "committing"}>
                取消
              </Button>
              <Button onClick={() => void commit()} disabled={phase === "committing" || sel.size === 0}>
                {phase === "committing" ? "写入中…" : `沉淀 ${sel.size} 条`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
