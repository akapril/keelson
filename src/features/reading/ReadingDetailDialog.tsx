// ReadingDetailDialog —— 阅读条目详情(交互):AI 摘要/要点、标签编辑、置顶、备注。
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  LinkSquare02Icon,
  AiChat02Icon,
  PinIcon,
} from "@hugeicons/core-free-icons";

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
import { Markdown } from "@/components/markdown";
import { useReadingStore } from "@/store/reading";
import { useReadingSummaryJob } from "./reading-summary-job";
import { splitTags, joinTags } from "./reading-utils";
import type { ReadingItem, ReadingStatus } from "@/types/reading";

const STATUS_LABEL: Record<ReadingStatus, string> = {
  unread: "未读",
  reading: "在读",
  archived: "已归档",
};

interface ReadingDetailDialogProps {
  item: ReadingItem | null;
  onClose: () => void;
}

export function ReadingDetailDialog({ item, onClose }: ReadingDetailDialogProps) {
  const updateItem = useReadingStore((s) => s.updateItem);
  // AI 摘要后台任务：进行中态取自模块级 store（详情弹窗关了再开仍正确）
  const summarizing = useReadingSummaryJob((s) => (item ? s.pending.has(item.id) : false));
  const startSummarize = useReadingSummaryJob((s) => s.start);
  const [tagInput, setTagInput] = useState("");

  // 切换条目时清空标签输入
  useEffect(() => {
    setTagInput("");
  }, [item?.id]);

  // 自动已读：打开详情即视为「开始阅读」——未读静默升级为在读。
  // 只动 unread（已归档/在读保持不变），非破坏、用户仍可手动改回。
  useEffect(() => {
    if (item && item.status === "unread") {
      void updateItem(item.id, { status: "reading" });
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

  // AI 摘要:后台发起，立即返回（不阻塞详情弹窗；完成写回后列表/详情自动刷新）
  const runSummarize = () => startSummarize(item);

  const addTag = () => {
    const next = splitTags(joinTags([...tags, tagInput]));
    setTagInput("");
    void updateItem(item.id, { tags: joinTags(next) });
  };
  const removeTag = (t: string) => {
    void updateItem(item.id, { tags: joinTags(tags.filter((x) => x !== t)) });
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle className="pr-6">{item.title || "阅读条目"}</DialogTitle>
          <DialogDescription>阅读条目详情与 AI 摘要</DialogDescription>
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
            <span className="text-muted-foreground">无链接</span>
          )}
          <Badge variant="secondary" className="shrink-0">
            {STATUS_LABEL[item.status] ?? item.status}
          </Badge>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              variant={item.pinned ? "secondary" : "ghost"}
              size="sm"
              onClick={() => void updateItem(item.id, { pinned: !item.pinned })}
              title={item.pinned ? "取消置顶" : "置顶"}
            >
              <HugeiconsIcon icon={PinIcon} strokeWidth={2} />
              {item.pinned ? "已置顶" : "置顶"}
            </Button>
            {item.url && (
              <Button variant="ghost" size="sm" disabled={summarizing} onClick={runSummarize}>
                <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} />
                {summarizing ? "摘要中…" : item.summary ? "重新摘要" : "AI 摘要"}
              </Button>
            )}
          </div>
        </div>

        {/* 标签 */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border py-2">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => removeTag(t)}
              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              title="点击删除"
            >
              {t} ✕
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
            placeholder="加标签，回车/逗号确认"
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
                    关键要点
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
              暂无 AI 摘要。{item.url ? "点右上「AI 摘要」抓取网页并生成。" : "该条目无链接。"}
            </p>
          )}
          {item.note?.trim() && (
            <div className="border-t border-border pt-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">备注</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{item.note}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
