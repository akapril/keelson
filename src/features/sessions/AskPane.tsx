// 会话中枢「问」模式：语义召回历史会话片段（永远先给列表），配了 AI 再综合答案带 [n] 引用。
// 召回为空（索引未建/失效）时回退关键词检索（sessions_search）。
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";
import { useSettingsStore } from "@/store/settings";
import { DEFAULT_EMBED_CONFIG } from "@/types/rag";
import type { RagHit } from "@/types/rag";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ensureInboxProject } from "@/lib/pb/board";
import { createDocRecord } from "@/lib/pb/docs";
import { currentUserId } from "@/lib/pb";
import { workspaceRecordUrl } from "@/lib/workspace-navigation";

// 嵌入配置：默认 mock（非真语义）；设置页可切 api / local。
function embedConfig() {
  try {
    const raw = localStorage.getItem("keelson-embed-config");
    return raw ? { ...DEFAULT_EMBED_CONFIG, ...JSON.parse(raw) } : DEFAULT_EMBED_CONFIG;
  } catch {
    return DEFAULT_EMBED_CONFIG;
  }
}

/** 是否配置了「真语义」嵌入：api(需 key) 或 local；mock 是假向量，不算。 */
function hasRealEmbedding(cfg: ReturnType<typeof embedConfig>): boolean {
  return cfg.provider === "local" || (cfg.provider === "api" && !!cfg.api_key);
}

/** 检索方式：语义 / 语义未就绪回退关键词 / 未配置语义直接关键词。 */
type Retrieval = "" | "semantic" | "kw-fallback" | "kw-only";

export function AskPane() {
  const { t } = useTranslation("sessions");
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<RagHit[]>([]);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [retrieval, setRetrieval] = useState<Retrieval>("");
  // 已问的问题（存文档时作标题/正文；ask 成功后固化，避免跟随输入框变化）
  const [asked, setAsked] = useState("");
  const [saving, setSaving] = useState(false);

  // 复制答案到剪贴板
  const copyAnswer = () => {
    void navigator.clipboard
      .writeText(answer)
      .then(() => toast.success(t("ask.toast.copiedAnswer")))
      .catch(() => toast.error(t("ask.toast.copyError")));
  };

  // 存为文档（落「速记」项目，含问题 + 答案 + 来源片段）
  const saveAsDoc = async () => {
    if (saving || !answer) return;
    setSaving(true);
    try {
      const q = asked || query.trim();
      const sources = hits
        .map((h, i) => `[${i + 1}] (${h.provider}) ${h.snippet}`)
        .join("\n\n");
      const content =
        `# ${q}\n\n${answer}\n` + (sources ? `\n---\n\n**${t("ask.docSourcesHeader")}**\n\n${sources}\n` : "");
      const inbox = await ensureInboxProject();
      const rec = await createDocRecord({
        owner: currentUserId(),
        project: inbox.id,
        title: q.slice(0, 60) || t("ask.docTitle"),
        content,
      });
      toast.success(t("ask.toast.savedDoc"), {
        action: {
          label: t("ask.toast.openDoc"),
          onClick: () =>
            navigate(workspaceRecordUrl("board", inbox.id, { tab: "docs", doc: rec.id })),
        },
      });
    } catch (e) {
      toast.error(t("ask.toast.saveDocError", { msg: String(e) }));
    } finally {
      setSaving(false);
    }
  };

  const ask = async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setAnswer("");
    setRetrieval("");
    setAsked(q);
    try {
      const cfg = embedConfig();
      const keyword = async (): Promise<RagHit[]> => {
        const kw = await ipc.searchSessions(q);
        return kw.map((h) => ({
          session_id: h.session_id,
          provider: h.provider,
          role: "user",
          snippet: h.snippet,
          score: h.score,
        }));
      };

      let list: RagHit[];
      if (hasRealEmbedding(cfg)) {
        // 配了真语义嵌入：语义召回；为空再回退关键词
        list = await ipc.ragSearch(cfg, q, 8);
        if (list.length === 0) {
          list = await keyword();
          setRetrieval("kw-fallback");
        } else {
          setRetrieval("semantic");
        }
      } else {
        // 未配置真语义（默认 mock=假向量）：直接关键词检索，不伪装成语义
        list = await keyword();
        setRetrieval("kw-only");
      }
      setHits(list);

      // 配了 AI → 用召回片段综合答案（带引用编号）
      const ai = useSettingsStore.getState().aiConfig;
      const isCli = ai.provider === "claude-cli" || ai.provider === "codex-cli";
      if (list.length > 0 && (ai.api_key || isCli)) {
        const ctx = list
          .map((h, i) => `[${i + 1}] (${h.provider}) ${h.snippet}`)
          .join("\n");
        const reply = await ipc.aiChat(ai, [
          { role: "system", content: "根据下列历史会话片段回答用户问题，用简洁中文，引用时标注 [编号]。" },
          { role: "user", content: `片段：\n${ctx}\n\n问题：${q}` },
        ]);
        setAnswer(reply);
      }
    } catch (e) {
      setAnswer(t("ask.toast.retrieveError", { msg: String(e) }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-1">
      <div className="flex items-end gap-2">
        <Textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
          }}
          placeholder={t("ask.placeholder")}
          className="min-h-12 flex-1"
        />
        <Button onClick={() => void ask()} disabled={loading || !query.trim()}>
          {loading ? t("ask.searching") : t("ask.ask")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {answer && (
          <div className="rounded-xl bg-muted p-3">
            <div className="whitespace-pre-wrap text-sm">{answer}</div>
            {/* 沉淀操作：复制 / 存为文档（闭合 问→沉淀 闭环） */}
            <div className="mt-2 flex items-center gap-2 border-t border-border/60 pt-2">
              <Button variant="ghost" size="xs" onClick={copyAnswer}>
                {t("ask.copyAnswer")}
              </Button>
              <Button variant="ghost" size="xs" disabled={saving} onClick={() => void saveAsDoc()}>
                {saving ? t("ask.saving") : t("ask.saveAsDoc")}
              </Button>
            </div>
          </div>
        )}
        {retrieval === "kw-only" && (
          <p className="text-xs text-muted-foreground">
            {t("ask.kwOnly")}
          </p>
        )}
        {retrieval === "kw-fallback" && hits.length > 0 && (
          <p className="text-xs text-muted-foreground">{t("ask.kwFallback")}</p>
        )}
        {hits.map((h, i) => (
          <button
            key={`${h.session_id}-${i}`}
            type="button"
            onClick={() => navigate(`/sessions?session=${encodeURIComponent(h.session_id)}`)}
            className="block w-full rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40"
          >
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5">[{i + 1}]</span>
              <span>{h.provider}</span>
              <span>· {retrieval === "semantic" ? t("ask.similarity") : t("ask.relevance")} {h.score.toFixed(2)}</span>
            </div>
            <p className="line-clamp-3 text-sm">{h.snippet}</p>
          </button>
        ))}
        {!loading && hits.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">{t("ask.emptyHint")}</p>
        )}
      </div>
    </div>
  );
}
