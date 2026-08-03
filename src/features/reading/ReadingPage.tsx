// Reading 页面 —— 阅读列表：添加、按状态筛选、状态流转、删除。
// 组件仅调用 store；数据访问由 store → src/lib/pb/reading.ts 收口。
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import { Virtualizer } from "virtua";
import {
  Add01Icon,
  AiChat02Icon,
  Delete02Icon,
  LinkSquare02Icon,
  TaskAdd01Icon,
} from "@hugeicons/core-free-icons";

import { useReadingStore } from "@/store/reading";
import type { ReadingItem, ReadingStatus } from "@/types/reading";
import { CreateTaskFromReadingDialog } from "./CreateTaskFromReadingDialog";
import { ReadingDetailDialog } from "./ReadingDetailDialog";
import { useReadingSummaryJob } from "./reading-summary-job";
import { groupReading, splitTags } from "@/features/reading/reading-utils";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
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

/** 从 URL 提取主机名用于小字展示；解析失败时回退原串 */
function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** 站点 favicon URL（用站点自身 /favicon.ico，失败时 <img> onError 隐藏，不请求第三方） */
function faviconUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.origin}/favicon.ico`;
  } catch {
    return null;
  }
}

/** 阅读时长估算：按缓存正文字数 / 每分钟 ~350 字（中英混排折中）；无正文返回 null。 */
function readingMinutes(contentText: string): number | null {
  const text = (contentText || "").trim();
  if (!text) return null;
  // 中文按字符计、英文按空格词计，取二者估算的较大值更贴近
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  const words = text.split(/\s+/).filter(Boolean).length;
  const units = Math.max(cjk, words);
  return Math.max(1, Math.round(units / 350));
}

// ── 单条阅读条目行 ─────────────────────────────────────────
interface ReadingRowProps {
  item: ReadingItem;
  /** 点击「建任务」：由页面打开建任务对话框 */
  onCreateTask: (item: ReadingItem) => void;
}

function ReadingRow({ item, onCreateTask }: ReadingRowProps) {
  const { t } = useTranslation("reading");
  const updateItem = useReadingStore((s) => s.updateItem);
  const removeItem = useReadingStore((s) => s.removeItem);
  // 详情对话框（完整查看备注 / AI 摘要）
  const [detailOpen, setDetailOpen] = useState(false);
  // AI 摘要后台任务：进行中状态取自模块级 store（切页面/重挂载仍正确）
  const summarizing = useReadingSummaryJob((s) => s.pending.has(item.id));
  const startSummarize = useReadingSummaryJob((s) => s.start);

  // 点开原文即视为开始阅读：未读 → 在读（不动已归档/在读）
  const markReading = () => {
    if (item.status === "unread")
      void updateItem(item.id, { status: "reading" }).catch((e) =>
        toast.error(t("toast.updateFailed", { msg: String(e) })),
      );
  };

  // 卡片一键 AI 摘要：后台发起，立即返回（不阻塞，可继续操作其它条目）
  const handleSummarize = () => startSummarize(item);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
    <Card size="sm" className="gap-2">
      <div className="flex items-start gap-3 px-4">
        {/* 标题 + 链接 + 标签胶囊 + 摘要/备注 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                onClick={markReading}
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

          {/* 站点 favicon + 域名 + 阅读时长（书签感） */}
          {item.url && (
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {faviconUrl(item.url) && (
                <img
                  src={faviconUrl(item.url)!}
                  alt=""
                  className="size-3.5 shrink-0 rounded-sm"
                  onError={(e) => {
                    e.currentTarget.style.display = "none"; // 站点无 favicon 时隐藏，不占位
                  }}
                />
              )}
              <span className="truncate">{urlHost(item.url)}</span>
              {readingMinutes(item.content_text) != null && (
                <span className="shrink-0">{t("row.readingMinutes", { n: readingMinutes(item.content_text) })}</span>
              )}
            </div>
          )}

          {/* 标签胶囊 */}
          {splitTags(item.tags).length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {splitTags(item.tags).map((tag) => (
                <span key={tag} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* 查看详情入口：始终可点（打开详情弹窗——即便还没摘要，也能在弹窗里粘正文/摘要/加标签）。
              有摘要/备注时额外显示截断预览。 */}
          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="mt-1 block w-full text-left"
            title={t("row.viewDetailTitle")}
          >
            {(item.summary || item.note) && (
              <span className="line-clamp-2 text-sm text-muted-foreground">
                {item.summary || item.note}
              </span>
            )}
            <span className="text-xs text-primary hover:underline">{t("row.viewDetail")}</span>
          </button>
        </div>

        {/* AI 摘要 + 建任务 + 状态切换 + 删除 */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* 一键 AI 摘要：仅有链接时可用；无摘要显示「AI 摘要」，已有则「重新摘要」 */}
          {item.url && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("row.aiSummarizeAriaLabel")}
              className="text-muted-foreground hover:text-foreground"
              disabled={summarizing}
              onClick={handleSummarize}
            >
              <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} />
              {summarizing ? t("row.summarizing") : item.summary ? t("row.aiResummarize") : t("row.aiSummarize")}
            </Button>
          )}
          {/* 从当前阅读条目创建看板任务 */}
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("row.createTaskAriaLabel")}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onCreateTask(item)}
          >
            <HugeiconsIcon icon={TaskAdd01Icon} strokeWidth={2} />
            {t("row.createTask")}
          </Button>

          <Select
            value={item.status}
            onValueChange={(v) =>
              void updateItem(item.id, { status: v as ReadingStatus }).catch((e) =>
                toast.error(t("toast.updateFailed", { msg: String(e) })),
              )
            }
          >
            <SelectTrigger size="sm" aria-label={t("row.changeStatusAriaLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["unread", "reading", "archived"] as ReadingStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`status.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="icon"
            aria-label={t("row.deleteAriaLabel")}
            className="text-muted-foreground hover:text-destructive"
            onClick={() =>
              void removeItem(item.id).catch((e) =>
                toast.error(t("toast.deleteFailed", { msg: String(e) })),
              )
            }
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        </div>
      </div>

      {/* 详情：完整查看备注 / AI 摘要 */}
      <ReadingDetailDialog
        item={detailOpen ? item : null}
        onClose={() => setDetailOpen(false)}
      />
    </Card>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {item.url && (
          <ContextMenuItem
            onSelect={() => {
              markReading();
              window.open(item.url, "_blank");
            }}
          >
            {t("context.openLink")}
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => setDetailOpen(true)}>{t("context.detail")}</ContextMenuItem>
        {item.url && (
          <ContextMenuItem disabled={summarizing} onSelect={handleSummarize}>
            {item.summary ? t("context.aiResummarize") : t("context.aiSummarize")}
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => onCreateTask(item)}>{t("context.createTask")}</ContextMenuItem>
        <ContextMenuSeparator />
        {(["unread", "reading", "archived"] as ReadingStatus[])
          .filter((s) => s !== item.status)
          .map((s) => (
            <ContextMenuItem
              key={s}
              onSelect={() =>
                void updateItem(item.id, { status: s }).catch((e) =>
                  toast.error(t("toast.updateFailed", { msg: String(e) })),
                )
              }
            >
              {t("context.markAs", { label: t(`status.${s}`) })}
            </ContextMenuItem>
          ))}
        <ContextMenuSeparator />
        {item.url && (
          <ContextMenuItem
            onSelect={() =>
              void navigator.clipboard
                .writeText(item.url)
                .then(() => toast.success(t("toast.linkCopied")))
            }
          >
            {t("context.copyLink")}
          </ContextMenuItem>
        )}
        <ContextMenuItem
          variant="destructive"
          onSelect={() =>
            void removeItem(item.id).catch((e) =>
              toast.error(t("toast.deleteFailed", { msg: String(e) })),
            )
          }
        >
          {t("context.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── 页面主体 ───────────────────────────────────────────────
export default function ReadingPage() {
  const { t } = useTranslation("reading");
  const items = useReadingStore((s) => s.items);
  const loading = useReadingStore((s) => s.loading);
  const error = useReadingStore((s) => s.error);
  const addItem = useReadingStore((s) => s.addItem);

  // 添加行的本地输入状态
  const [titleInput, setTitleInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  // 状态筛选
  const [filter, setFilter] = useState<FilterValue>("all");
  // 关键词搜索（标题 / 链接 / 标签）
  const [query, setQuery] = useState("");
  // 建任务对话框：当前选中的来源阅读条目（null = 关闭）
  const [taskFromItem, setTaskFromItem] = useState<ReadingItem | null>(null);

  // 挂载时加载数据并订阅；卸载时清理
  useEffect(() => {
    void useReadingStore.getState().load();
    return () => {
      useReadingStore.getState().close();
    };
  }, []);

  // 先按状态筛、再按关键词（标题 / url / 标签）过滤
  const visible = useMemo(() => {
    const byStatus = filter === "all" ? items : items.filter((it) => it.status === filter);
    const q = query.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        it.url.toLowerCase().includes(q) ||
        splitTags(it.tags).some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [items, filter, query]);

  // 压平「置顶 + 其余」为一维行序列，交给 virtua 虚拟化（阅读条目多也只渲染可视区行）。
  // header 只在有置顶时出现（与原分组渲染一致）。
  const rows = useMemo<
    Array<{ kind: "header"; label: string } | { kind: "card"; item: ReadingItem }>
  >(() => {
    const { pinned, rest } = groupReading(visible);
    const out: Array<{ kind: "header"; label: string } | { kind: "card"; item: ReadingItem }> = [];
    if (pinned.length > 0) {
      out.push({ kind: "header", label: t("section.pinned", { count: pinned.length }) });
      for (const it of pinned) out.push({ kind: "card", item: it });
      out.push({ kind: "header", label: t("section.recent") });
    }
    for (const it of rest) out.push({ kind: "card", item: it });
    return out;
  }, [visible, t]);

  // 提交添加：标题或链接至少一个。书签式：只贴链接也能存，标题空则用域名兜底。
  const handleAdd = async () => {
    const ti = titleInput.trim();
    const u = urlInput.trim();
    if (!ti && !u) return;
    // 标题兜底：无标题但有链接 → 用域名当标题（书签感，随后可 AI 摘要补全）
    const finalTitle = ti || (u ? urlHost(u) : "");
    if (!finalTitle) return;
    await addItem({ title: finalTitle, url: u });
    setTitleInput("");
    setUrlInput("");
  };

  // 筛选项（全部 + 三种状态），label 来自 i18n
  const filterOptions: { value: FilterValue }[] = [
    { value: "all" },
    { value: "unread" },
    { value: "reading" },
    { value: "archived" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      {/* 头部：标题 + 副标题 */}
      <header className="mb-4 shrink-0">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          {t("page.title")}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t("page.subtitle")}
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
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder={t("add.urlPlaceholder")}
          className="flex-1"
          aria-label={t("add.urlAriaLabel")}
        />
        <Input
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          placeholder={t("add.titlePlaceholder")}
          className="flex-1"
          aria-label={t("add.titleAriaLabel")}
        />
        <Button type="submit" disabled={!titleInput.trim() && !urlInput.trim()}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          {t("add.button")}
        </Button>
      </form>

      {/* 状态筛选：分段控件 */}
      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(v as FilterValue)}
        className="mb-3 shrink-0"
      >
        <TabsList>
          {filterOptions.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {t(`filter.${f.value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* 搜索框：标题 / 链接 / 标签关键词过滤 */}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("search.placeholder")}
        className="mb-3 shrink-0"
        aria-label={t("search.ariaLabel")}
      />

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
            {t("common:state.loading")}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
            <span>{filter === "all" ? t("empty.all") : t("empty.byStatus")}</span>
            {filter === "all" && (
              <span className="text-xs">{t("empty.hint")}</span>
            )}
          </div>
        ) : (
          // virtua 虚拟化：压平的 rows 只渲染可视区（置顶头/最近头 + 卡片）
          <Virtualizer>
            {rows.map((row, i) =>
              row.kind === "header" ? (
                <h2
                  key={`h:${i}:${row.label}`}
                  className="mb-2 mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0"
                >
                  {row.label}
                </h2>
              ) : (
                <div key={row.item.id} className="pb-2">
                  <ReadingRow item={row.item} onCreateTask={setTaskFromItem} />
                </div>
              ),
            )}
          </Virtualizer>
        )}
      </div>

      {/* 从阅读条目建任务对话框（选中条目时渲染） */}
      {taskFromItem && (
        <CreateTaskFromReadingDialog
          item={taskFromItem}
          onClose={() => setTaskFromItem(null)}
        />
      )}
    </div>
  );
}
