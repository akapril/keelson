// Reading 页面 —— 阅读列表：添加、按状态筛选、状态流转、删除。
// 组件仅调用 store；数据访问由 store → src/lib/pb/reading.ts 收口。
import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon, LinkSquare02Icon } from "@hugeicons/core-free-icons";

import { useReadingStore } from "@/store/reading";
import type { ReadingItem, ReadingStatus } from "@/types/reading";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

// ── 筛选选项（全部 + 三种状态） ────────────────────────────
type FilterValue = "all" | ReadingStatus;

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "unread", label: "未读" },
  { value: "reading", label: "在读" },
  { value: "archived", label: "已归档" },
];

// ── 状态下拉选项 ───────────────────────────────────────────
const STATUS_OPTIONS: { value: ReadingStatus; label: string }[] = [
  { value: "unread", label: "未读" },
  { value: "reading", label: "在读" },
  { value: "archived", label: "已归档" },
];

/** 从 URL 提取主机名用于小字展示；解析失败时回退原串 */
function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ── 单条阅读条目行 ─────────────────────────────────────────
interface ReadingRowProps {
  item: ReadingItem;
}

function ReadingRow({ item }: ReadingRowProps) {
  const updateItem = useReadingStore((s) => s.updateItem);
  const removeItem = useReadingStore((s) => s.removeItem);

  return (
    <Card size="sm" className="gap-2">
      <div className="flex items-start gap-3 px-4">
        {/* 标题 + 链接 + 备注 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-sm font-medium text-foreground hover:underline"
              >
                {item.title}
              </a>
            ) : (
              <span className="truncate text-sm font-medium text-foreground">
                {item.title}
              </span>
            )}
            {item.url && (
              <HugeiconsIcon
                icon={LinkSquare02Icon}
                strokeWidth={2}
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            )}
          </div>

          {/* 链接主机名（小字） */}
          {item.url && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {urlHost(item.url)}
            </p>
          )}

          {/* 备注（仅在有值时展示） */}
          {item.note && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {item.note}
            </p>
          )}
        </div>

        {/* 状态切换 + 删除 */}
        <div className="flex shrink-0 items-center gap-1.5">
          <Select
            value={item.status}
            onValueChange={(v) =>
              void updateItem(item.id, { status: v as ReadingStatus })
            }
          >
            <SelectTrigger size="sm" aria-label="修改状态">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="icon"
            aria-label="删除"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => void removeItem(item.id)}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ── 页面主体 ───────────────────────────────────────────────
export default function ReadingPage() {
  const items = useReadingStore((s) => s.items);
  const loading = useReadingStore((s) => s.loading);
  const error = useReadingStore((s) => s.error);
  const addItem = useReadingStore((s) => s.addItem);

  // 添加行的本地输入状态
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  // 状态筛选
  const [filter, setFilter] = useState<FilterValue>("all");

  // 挂载时加载数据并订阅；卸载时清理
  useEffect(() => {
    void useReadingStore.getState().load();
    return () => {
      useReadingStore.getState().close();
    };
  }, []);

  // 按当前筛选过滤列表
  const visible = useMemo(
    () =>
      filter === "all" ? items : items.filter((it) => it.status === filter),
    [items, filter],
  );

  // 提交添加：标题必填，成功后清空输入
  const handleAdd = async () => {
    const t = title.trim();
    if (!t) return;
    await addItem({ title: t, url: url.trim() });
    setTitle("");
    setUrl("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      {/* 头部：标题 + 副标题 */}
      <header className="mb-4 shrink-0">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          阅读
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          收藏想读的链接与文章，随手记录、按状态归档。
        </p>
      </header>

      {/* 添加行：标题（必填） + 链接（可选） + 添加按钮 */}
      <form
        className="mb-3 flex shrink-0 items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void handleAdd();
        }}
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="标题（必填）"
          className="flex-1"
          aria-label="标题"
        />
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="链接（可选）"
          className="flex-1"
          aria-label="链接"
        />
        <Button type="submit" disabled={!title.trim()}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          添加
        </Button>
      </form>

      {/* 状态筛选：分段控件 */}
      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(v as FilterValue)}
        className="mb-3 shrink-0"
      >
        <TabsList>
          {FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* 错误提示 */}
      {error && (
        <div
          role="alert"
          className="mb-3 shrink-0 rounded-md border border-destructive bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* 列表区域（可滚动） */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            加载中…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
            <span>{filter === "all" ? "暂无阅读条目" : "该状态下暂无条目"}</span>
            {filter === "all" && (
              <span className="text-xs">在上方添加第一条阅读记录</span>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map((item) => (
              <ReadingRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
