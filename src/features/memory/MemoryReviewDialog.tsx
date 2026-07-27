// MemoryReviewDialog —— 从会话提炼记忆：AI 出候选 → 去重分类 → 勾选确认 → 写 memories。
import { DEFAULT_EMBED_CONFIG } from "@/types/rag";
import { classifyBySimilarity } from "./extract";

// 读设置页存的嵌入配置（与 AskPane 同源 localStorage）
function readEmbedConfig() {
  try {
    const raw = localStorage.getItem("rework-embed-config");
    return raw ? { ...DEFAULT_EMBED_CONFIG, ...JSON.parse(raw) } : DEFAULT_EMBED_CONFIG;
  } catch {
    return DEFAULT_EMBED_CONFIG;
  }
}
function hasRealEmbedding(c: ReturnType<typeof readEmbedConfig>): boolean {
  return c.provider === "local" || (c.provider === "api" && !!c.api_key);
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import type { Memory } from "@/types/memory";
import type { Session } from "@/types/session";

type Phase = "loading" | "idle" | "review" | "committing";

// 错误哨兵键：setError 存 i18n key，渲染时统一经 t() 转换
const ERR_NO_AI = "reviewDialog.errorNoAi";

export function MemoryReviewDialog({
  session,
  onClose,
}: {
  session: Session | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("memory");
  const [phase, setPhase] = useState<Phase>("idle");
  // error 字段存 i18n key（ERR_NO_AI）或 String(e) 原始错误（非中文，不需翻译）
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
          // 存哨兵 key，渲染时经 t() 翻译
          setError(ERR_NO_AI);
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
        const cands = parseMemories(reply);
        let classified;
        const embedCfg = readEmbedConfig();
        if (cands.length > 0 && hasRealEmbedding(embedCfg)) {
          // 语义去重：一次批量嵌入 [候选 + 已有]，失败则回退字符级
          try {
            const texts = [...cands.map((c) => c.content), ...existing.map((m) => m.content)];
            const vecs = await ipc.embedTexts(embedCfg, texts);
            if (cancelled) return;
            if (vecs.length === texts.length) {
              const candVecs = vecs.slice(0, cands.length);
              const existVecs = vecs.slice(cands.length);
              classified = classifyBySimilarity(cands, existing, candVecs, existVecs);
            } else {
              classified = classifyCandidates(cands, existing);
            }
          } catch {
            classified = classifyCandidates(cands, existing);
          }
        } else {
          classified = classifyCandidates(cands, existing);
        }
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
      toast.success(t("reviewDialog.toastSuccess", { count: chosen.length }));
      onClose();
    } catch (e) {
      setError(String(e));
      setPhase("review");
    }
  };

  const freshCount = items.filter((c) => c.duplicateOf === null).length;

  // 将 error 字段翻译：若是哨兵 key 则走 t()，否则直接显示原始错误信息
  const errorDisplay = error === ERR_NO_AI ? t(ERR_NO_AI) : error;

  return (
    <Dialog open={!!session} onOpenChange={(o) => !o && phase !== "committing" && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{t("reviewDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("reviewDialog.description")}
          </DialogDescription>
        </DialogHeader>

        {(phase === "loading" || phase === "idle") && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            {phase === "loading" ? (
              <span>{t("reviewDialog.loading")}</span>
            ) : (
              <span className="text-destructive">{errorDisplay ?? t("reviewDialog.errorFallback")}</span>
            )}
          </div>
        )}

        {(phase === "review" || phase === "committing") && (
          <>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto py-1">
              {items.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">{t("reviewDialog.emptyResult")}</p>
              )}
              {items.map((item, i) => {
                const dup = item.duplicateOf !== null;
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
                      <span className="text-foreground">{item.candidate.content}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="rounded bg-muted px-1">{t(`kind.${item.candidate.kind}`)}</span>
                        <span className="rounded bg-muted px-1">
                          {item.candidate.scope === "global" ? t("reviewDialog.scopeGlobal") : t("reviewDialog.scopeProject")}
                        </span>
                        <span>{t("reviewDialog.confidence", { value: item.candidate.confidence })}</span>
                        {dup && (
                          <span className="text-amber-600 dark:text-amber-400">
                            {item.duplicateOf ? t("reviewDialog.dupExisting") : t("reviewDialog.dupBatch")}
                          </span>
                        )}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            {error && <p className="shrink-0 text-xs text-destructive">{errorDisplay}</p>}

            <DialogFooter className="items-center">
              <span className="mr-auto text-xs text-muted-foreground">
                {t("reviewDialog.footerCount", { fresh: freshCount, selected: sel.size })}
              </span>
              <Button variant="outline" onClick={onClose} disabled={phase === "committing"}>
                {t("common:action.cancel")}
              </Button>
              <Button onClick={() => void commit()} disabled={phase === "committing" || sel.size === 0}>
                {phase === "committing" ? t("reviewDialog.committing") : t("reviewDialog.commitButton", { count: sel.size })}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
