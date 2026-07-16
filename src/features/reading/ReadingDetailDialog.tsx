// ReadingDetailDialog —— 阅读条目详情：完整查看备注/AI 摘要（列表里是截断显示）。
import { HugeiconsIcon } from "@hugeicons/react";
import { LinkSquare02Icon } from "@hugeicons/core-free-icons";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
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
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle className="pr-6">{item?.title || "阅读条目"}</DialogTitle>
          <DialogDescription>阅读条目详情与 AI 摘要</DialogDescription>
        </DialogHeader>

        {/* 链接 + 状态 */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border pb-3 text-xs">
          {item?.url ? (
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
          {item && (
            <Badge variant="secondary" className="ml-auto shrink-0">
              {STATUS_LABEL[item.status] ?? item.status}
            </Badge>
          )}
        </div>

        {/* 完整备注 / AI 摘要（保留换行与项目符号） */}
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {item?.note?.trim() ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {item.note}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              暂无备注/摘要。点击列表中的「AI 解析」可抓取网页并生成摘要。
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
