// 阅读 AI 摘要的「后台任务」store：发起后立即返回，抓网页+调 AI 在后台跑，
// 完成写回 reading store（列表自动刷新）+ toast，失败 toast。多条可并发、互不阻塞。
// 进行中的 id 集合放模块级 store，使切页面/重挂载后按钮态仍正确（不随组件本地 state 丢）。
import { create } from "zustand";
import { toast } from "sonner";
import i18n from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { useReadingStore } from "@/store/reading";
import { summarizeReadingItem } from "./summarize";
import type { ReadingItem } from "@/types/reading";

interface ReadingSummaryJobState {
  /** 正在摘要的条目 id 集合（新 Set 引用触发订阅刷新） */
  pending: Set<string>;
  /**
   * 后台发起某条目的摘要（不阻塞；含无 key 门禁 + 完成/失败 toast）。
   * @param pastedContent 可选手动粘贴正文（登录墙等抓不到时用）；有值则跳过抓取、不强制要求 url。
   */
  start: (item: ReadingItem, pastedContent?: string) => void;
}

export const useReadingSummaryJob = create<ReadingSummaryJobState>((set, get) => ({
  pending: new Set(),

  start: (item, pastedContent) => {
    if (get().pending.has(item.id)) return; // 该条目已在摘要中
    // 有粘贴正文时不强制要求 url（登录墙/无链接条目也能凭粘贴内容摘要）
    if (!pastedContent?.trim() && !item.url) {
      toast.error(i18n.t("toast.noLinkToSummarize", { ns: "reading" }));
      return;
    }
    const cfg = useSettingsStore.getState().aiConfig;
    const isCli = cfg.provider === "claude-cli" || cfg.provider === "codex-cli";
    if (!isCli && !cfg.api_key) {
      toast.error(i18n.t("toast.noAiConfig", { ns: "reading" }));
      return;
    }

    // 标记进行中
    set((s) => {
      const next = new Set(s.pending);
      next.add(item.id);
      return { pending: next };
    });

    void summarizeReadingItem(item, cfg, pastedContent)
      .then(async (r) => {
        const patch: Record<string, unknown> = {
          summary: r.summary,
          key_points: JSON.stringify(r.key_points),
          content_text: r.content_text,
        };
        // AI 推荐标签：仅当条目还没有标签时自动填（不覆盖用户已有）
        const fillTags = r.tags.length > 0 && !item.tags?.trim();
        if (fillTags) patch.tags = r.tags.join(",");
        await useReadingStore.getState().updateItem(item.id, patch);
        toast.success(
          fillTags
            ? i18n.t("toast.summarizeDoneWithTags", { ns: "reading", title: item.title, n: r.tags.length })
            : i18n.t("toast.summarizeDone", { ns: "reading", title: item.title }),
        );
      })
      .catch((e) => {
        // 将 summarize.ts 的英文 sentinel 映射到 i18n key，避免中文错误串直接露给用户
        const SENTINEL: Record<string, string> = {
          NO_LINK: "summarizeError.noLink",
          NO_CONTENT: "summarizeError.noContent",
          PARSE_FAILED: "summarizeError.parseFailed",
        };
        const raw = e instanceof Error ? e.message : String(e);
        const msg = SENTINEL[raw] ? i18n.t(SENTINEL[raw], { ns: "reading" }) : raw;
        toast.error(i18n.t("toast.summarizeFailed", { ns: "reading", title: item.title, msg }));
      })
      .finally(() => {
        set((s) => {
          const next = new Set(s.pending);
          next.delete(item.id);
          return { pending: next };
        });
      });
  },
}));
