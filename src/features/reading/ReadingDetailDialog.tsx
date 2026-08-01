// ReadingDetailDialog —— 阅读条目详情(交互):AI 摘要/要点、标签编辑、置顶、备注。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  LinkSquare02Icon,
  AiChat02Icon,
  PinIcon,
} from "@hugeicons/core-free-icons";

import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { useReadingStore } from "@/store/reading";
import { useReadingSummaryJob } from "./reading-summary-job";
import { splitTags, joinTags } from "./reading-utils";
import type { ReadingItem, ReadingStatus } from "@/types/reading";

interface ReadingDetailDialogProps {
  item: ReadingItem | null;
  onClose: () => void;
}

export function ReadingDetailDialog({ item, onClose }: ReadingDetailDialogProps) {
  const { t } = useTranslation("reading");
  const updateItem = useReadingStore((s) => s.updateItem);
  // AI 摘要后台任务：进行中态取自模块级 store（详情弹窗关了再开仍正确）
  const summarizing = useReadingSummaryJob((s) => (item ? s.pending.has(item.id) : false));
  const startSummarize = useReadingSummaryJob((s) => s.start);
  const [tagInput, setTagInput] = useState("");
  // 手动粘贴正文（登录墙/付费墙/JS 渲染站抓不到时用）：有值则 AI 摘要用它、跳过抓取
  const [pasted, setPasted] = useState("");
  const [showPaste, setShowPaste] = useState(false);

  // 切换条目时清空标签输入 + 重置粘贴态（避免上一条残留）
  useEffect(() => {
    setTagInput("");
    setPasted("");
    setShowPaste(false);
  }, [item?.id]);

  // 自动已读：打开详情即视为「开始阅读」——未读静默升级为在读。
  // 只动 unread（已归档/在读保持不变），非破坏、用户仍可手动改回。
  useEffect(() => {
    if (item && item.status === "unread") {
      void updateItem(item.id, { status: "reading" }).catch((e) =>
        toast.error(t("toast.updateFailed", { msg: String(e) })),
      );
    }
    // 仅在打开的条目切换时判断一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  if (!item) {
    return (
      <Dialog open={false} onOpenChange={(o) => !o && onClose()}>
        <DialogContent />
      </Dialog>
    );
  }

  const tags = splitTags(item.tags);
  const keyPoints: string[] = (() => {
    try {
      const v = JSON.parse(item.key_points || "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  })();

  // AI 摘要:后台发起，立即返回（不阻塞详情弹窗；完成写回后列表/详情自动刷新）。
  // 有粘贴正文则用它（跳过抓取，覆盖登录墙/JS 渲染站）。
  const runSummarize = () => startSummarize(item, pasted.trim() || undefined);

  const addTag = () => {
    const next = splitTags(joinTags([...tags, tagInput]));
    setTagInput("");
    void updateItem(item.id, { tags: joinTags(next) }).catch((e) =>
      toast.error(t("toast.tagUpdateFailed", { msg: String(e) })),
    );
  };
  const removeTag = (tag: string) => {
    void updateItem(item.id, { tags: joinTags(tags.filter((x) => x !== tag)) }).catch((e) =>
      toast.error(t("toast.tagUpdateFailed", { msg: String(e) })),
    );
  };

  // 状态标签通过 i18n 获取
  const statusLabel = (status: ReadingStatus) => t(`status.${status}`);

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle className="pr-6">{item.title || t("detail.defaultTitle")}</DialogTitle>
          <DialogDescription>{t("detail.description")}</DialogDescription>
        </DialogHeader>

        {/* 链接 + 状态 + 操作 */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border pb-3 text-xs">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1 truncate text-primary hover:underline"
              title={item.url}
            >
              <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} className="size-3.5 shrink-0" />
              <span className="truncate">{item.url}</span>
            </a>
          ) : (
            <span className="text-muted-foreground">{t("detail.noLink")}</span>
          )}
          <Badge variant="secondary" className="shrink-0">
            {statusLabel(item.status)}
          </Badge>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              variant={item.pinned ? "secondary" : "ghost"}
              size="sm"
              onClick={() =>
                void updateItem(item.id, { pinned: !item.pinned }).catch((e) =>
                  toast.error(t("toast.pinFailed", { msg: String(e) })),
                )
              }
              title={item.pinned ? t("detail.unpin") : t("detail.pin")}
            >
              <HugeiconsIcon icon={PinIcon} strokeWidth={2} />
              {item.pinned ? t("detail.pinned") : t("detail.pin")}
            </Button>
            {/* 粘贴正文开关：登录墙/付费墙/JS 渲染站抓不到时，粘正文再摘要 */}
            <Button
              variant={showPaste || pasted.trim() ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowPaste((v) => !v)}
              title={t("detail.pasteToggleHint")}
            >
              {t("detail.pasteToggle")}
            </Button>
            {(item.url || pasted.trim()) && (
              <Button variant="ghost" size="sm" disabled={summarizing} onClick={runSummarize}>
                <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} />
                {summarizing ? t("detail.summarizing") : item.summary ? t("detail.aiResummarize") : t("detail.aiSummarize")}
              </Button>
            )}
          </div>
        </div>

        {/* 粘贴正文（登录墙/付费墙/JS 渲染站抓不到时用）：有内容则 AI 摘要用它、跳过抓取 */}
        {showPaste && (
          <div className="shrink-0 space-y-1.5 border-b border-border py-2">
            <p className="text-xs text-muted-foreground">{t("detail.pasteHint")}</p>
            <Textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={t("detail.pastePlaceholder")}
              className="max-h-40 min-h-20 text-xs"
            />
          </div>
        )}

        {/* 标签 */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border py-2">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => removeTag(tag)}
              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              title={t("detail.tagClickToRemove")}
            >
              {tag} ✕
            </button>
          ))}
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder={t("detail.tagPlaceholder")}
            className="h-7 w-40 text-xs"
          />
        </div>

        {/* 摘要 / 要点 / 备注 */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-2">
          {item.summary ? (
            <div>
              {/* 摘要为 markdown（TL;DR 黑体 + 分段），用 Markdown 组件渲染格式 */}
              <Markdown content={item.summary} />
              {keyPoints.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("detail.keyPoints")}
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                    {keyPoints.map((k, i) => (
                      <li key={i}>{k}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {item.url ? t("detail.noSummaryWithLink") : t("detail.noSummaryNoLink")}
            </p>
          )}
          {item.note?.trim() && (
            <div className="border-t border-border pt-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t("detail.note")}</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{item.note}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
