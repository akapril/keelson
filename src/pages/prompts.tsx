// 指令库 —— 可复用 prompt/片段的管理：搜索 + 标签筛选 + 增删改 + 复制。
// 插入到会话/AI 面板由 PromptPicker（按钮）与斜杠补全负责（见 features/prompts）。
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import {
  listPrompts,
  createPromptRecord,
  updatePromptRecord,
  deletePromptRecord,
} from "@/lib/pb/prompts";
import { currentUserId } from "@/lib/pb";
import { splitTags, promptType, PROMPT_TYPE_LABEL } from "@/features/prompts/prompt-utils";
import { PromptEditDialog } from "@/features/prompts/PromptEditDialog";
import { cn } from "@/lib/utils";
import type { PromptType } from "@/types/prompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Prompt } from "@/types/prompt";

export default function PromptsPage() {
  const [searchParams] = useSearchParams();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  // 类型筛选："all" | snippet | report；初值取 ?type= （报告页跳来时为 report）
  const [typeFilter, setTypeFilter] = useState<"all" | PromptType>(
    searchParams.get("type") === "report"
      ? "report"
      : searchParams.get("type") === "snippet"
        ? "snippet"
        : "all",
  );
  // undefined=不开；null=新建；Prompt=编辑
  const [editing, setEditing] = useState<Prompt | null | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<Prompt | null>(null);

  const load = () => {
    setLoading(true);
    listPrompts()
      .then(setPrompts)
      .catch(() => setPrompts([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const p of prompts) for (const t of splitTags(p.tags)) s.add(t);
    return [...s].sort();
  }, [prompts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return prompts.filter(
      (p) =>
        (typeFilter === "all" || promptType(p) === typeFilter) &&
        (!tag || splitTags(p.tags).includes(tag)) &&
        (!q ||
          p.title.toLowerCase().includes(q) ||
          p.content.toLowerCase().includes(q)),
    );
  }, [prompts, query, tag, typeFilter]);

  const save = async (data: {
    title: string;
    content: string;
    tags: string;
    type: PromptType;
  }) => {
    if (editing) {
      const updated = await updatePromptRecord(editing.id, data);
      setPrompts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } else {
      const created = await createPromptRecord({ owner: currentUserId(), ...data });
      setPrompts((prev) => [created, ...prev]);
    }
  };

  const remove = async (p: Prompt) => {
    setPrompts((prev) => prev.filter((x) => x.id !== p.id));
    try {
      await deletePromptRecord(p.id);
    } catch (e) {
      toast.error(`删除失败：${String(e)}`);
      load();
    }
  };

  const copy = (p: Prompt) =>
    void navigator.clipboard.writeText(p.content).then(
      () => toast.success("已复制指令"),
      () => toast.error("复制失败"),
    );

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-4 p-6">
      <header className="flex shrink-0 items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">指令库</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            可复用 prompt：<b>片段</b>（会话/AI 面板插入，支持 {`{{project}}`} 变量）与
            <b>报告模板</b>（工作报告的格式）。
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing(null)}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          新建指令
        </Button>
      </header>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索指令（标题 + 正文）…"
        className="shrink-0"
      />

      {/* 类型筛选：全部 / 片段 / 报告模板 */}
      <div className="flex shrink-0 gap-1.5">
        {([["all", "全部"], ["snippet", PROMPT_TYPE_LABEL.snippet], ["report", PROMPT_TYPE_LABEL.report]] as const).map(
          ([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTypeFilter(k)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                typeFilter === k
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {label}
            </button>
          ),
        )}
      </div>

      {/* 标签筛选 */}
      {allTags.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setTag(null)}
            className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
              tag === null ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            全部
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTag(t)}
              className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                tag === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">加载中…</p>
        ) : visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {prompts.length === 0 ? "还没有指令，点右上「新建指令」开始。" : "没有匹配的指令。"}
          </p>
        ) : (
          visible.map((p) => (
            <div key={p.id} className="group rounded-xl border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  {/* 类型徽标：报告模板高亮，片段淡色 */}
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px]",
                      promptType(p) === "report"
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {PROMPT_TYPE_LABEL[promptType(p)]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {p.title}
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button size="xs" variant="ghost" onClick={() => copy(p)}>
                    复制
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setEditing(p)}>
                    编辑
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingDelete(p)}
                  >
                    删除
                  </Button>
                </div>
              </div>
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                {p.content}
              </p>
              {splitTags(p.tags).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {splitTags(p.tags).map((t) => (
                    <span key={t} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <PromptEditDialog
        prompt={editing ?? null}
        open={editing !== undefined}
        // 新建时默认类型跟随当前筛选（报告页跳来 ?type=report 时即 report）
        defaultType={typeFilter === "all" ? "snippet" : typeFilter}
        onClose={() => setEditing(undefined)}
        onSave={save}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除此指令？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.title}」将被永久删除，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) void remove(pendingDelete);
                setPendingDelete(null);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
