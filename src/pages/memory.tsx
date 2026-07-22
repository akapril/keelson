// 记忆账本 —— 查看/筛选/编辑/删除跨厂商提炼的记忆；每条可溯源回跳原会话。
import { useEffect, useMemo, useState } from "react";
import { Virtualizer } from "virtua";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { listMemories, updateMemoryRecord, deleteMemoryRecord } from "@/lib/pb/memory";
import { MEMORY_KIND_LABEL, type Memory, type MemoryKind } from "@/types/memory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/markdown";
import { MemoryEditDialog } from "@/features/memory/MemoryEditDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const KINDS: (MemoryKind | "all")[] = ["all", "fact", "preference", "decision", "convention"];

export default function MemoryPage() {
  const navigate = useNavigate();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<MemoryKind | "all">("all");
  const [scope, setScope] = useState<"all" | "global" | "project">("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Memory | null>(null);
  // 批量选择
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const load = () => {
    setLoading(true);
    listMemories()
      .then(setMemories)
      .catch(() => setMemories([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return memories.filter(
      (m) =>
        !m.superseded_by &&
        m.status !== "pending" && // 待审记忆单独展示，不混入主账本
        (kind === "all" || m.kind === kind) &&
        (scope === "all" || m.scope === scope) &&
        (!q || m.content.toLowerCase().includes(q)),
    );
  }, [memories, kind, scope, query]);

  // 待审记忆（外部 AI 经 MCP create_memory 写入，需采纳后才入账）
  const pending = useMemo(
    () => memories.filter((m) => m.status === "pending" && !m.superseded_by),
    [memories],
  );

  // 采纳：置为 accepted，正式入账
  const accept = async (m: Memory) => {
    setMemories((prev) =>
      prev.map((x) => (x.id === m.id ? { ...x, status: "accepted" } : x)),
    );
    try {
      await updateMemoryRecord(m.id, { status: "accepted" });
    } catch (e) {
      toast.error(`采纳失败：${String(e)}`);
      load();
    }
  };

  const remove = async (m: Memory) => {
    setMemories((prev) => prev.filter((x) => x.id !== m.id));
    try {
      await deleteMemoryRecord(m.id);
    } catch (e) {
      toast.error(`删除失败：${String(e)}`);
      load();
    }
  };

  // 批量删除所选记忆（逐条删；失败则重载兜底）
  const batchDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setMemories((prev) => prev.filter((x) => !selected.has(x.id)));
    exitSelect();
    try {
      for (const id of ids) await deleteMemoryRecord(id);
      toast.success(`已删除 ${ids.length} 条记忆`);
    } catch (e) {
      toast.error(`批量删除失败：${String(e)}`);
      load();
    }
  };

  const saveEdit = async (value: string | null) => {
    const m = editing;
    setEditing(null);
    if (m === null || value === null) return;
    const content = value.trim();
    if (!content) return;
    setMemories((prev) => prev.map((x) => (x.id === m.id ? { ...x, content } : x)));
    try {
      await updateMemoryRecord(m.id, { content });
    } catch (e) {
      toast.error(`保存失败：${String(e)}`);
      load();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      <header className="mb-4 shrink-0">
        <h1 className="font-heading text-xl font-semibold text-foreground">记忆账本</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          从 claude / codex 会话提炼、去重的可复用记忆；喂回任一 CLI（外部经 MCP search_memory 查询）。
        </p>
      </header>

      {/* 待审记忆（外部 AI 经 MCP 写入，采纳后才进主账本；防 AI 乱写污染） */}
      {pending.length > 0 && (
        <div className="mb-3 shrink-0 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            待审记忆（{pending.length}）
            <span className="font-normal text-muted-foreground">
              — 外部 AI 经 MCP 写入，采纳后才进账本
            </span>
          </div>
          <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto">
            {pending.map((m) => (
              <div
                key={m.id}
                className="flex items-start gap-2 rounded-lg border border-border bg-card p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="break-words text-sm text-foreground">
                    <Markdown content={m.content} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="rounded bg-muted px-1">{MEMORY_KIND_LABEL[m.kind]}</span>
                    <span className="rounded bg-muted px-1">
                      {m.scope === "global" ? "全局" : "项目"}
                    </span>
                    {m.source_provider && (
                      <span className="rounded bg-muted px-1">来源：{m.source_provider}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="xs" onClick={() => void accept(m)}>
                    采纳
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void remove(m)}
                  >
                    丢弃
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 筛选 */}
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={(v) => setKind(v as MemoryKind | "all")}>
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {k === "all" ? "全部类别" : MEMORY_KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={scope} onValueChange={(v) => setScope(v as "all" | "global" | "project")}>
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部作用域</SelectItem>
            <SelectItem value="global">全局</SelectItem>
            <SelectItem value="project">项目</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索记忆…"
          className="h-9 max-w-xs flex-1"
        />
        <span className="ml-auto text-xs text-muted-foreground">{visible.length} 条</span>
        <button
          type="button"
          onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          aria-pressed={selectMode}
          className={`shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors ${
            selectMode ? "bg-accent text-primary" : "text-muted-foreground hover:bg-accent/50"
          }`}
        >
          批量
        </button>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">加载中…</p>
        ) : visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            暂无记忆。在会话预览点「提炼记忆」从会话沉淀。
          </p>
        ) : (
          <Virtualizer>
            {visible.map((m) => {
              const isSel = selected.has(m.id);
              return (
                <div
                  key={m.id}
                  onClick={selectMode ? () => toggleSel(m.id) : undefined}
                  className={`group mb-1.5 flex items-start gap-2.5 rounded-lg border p-2.5 ${
                    selectMode ? "cursor-pointer" : ""
                  } ${
                    isSel ? "border-primary/60 bg-primary/5" : "border-border bg-card"
                  }`}
                >
                  {selectMode && (
                    <input
                      type="checkbox"
                      checked={isSel}
                      readOnly
                      className="mt-0.5 size-3.5 shrink-0 accent-primary"
                      aria-label="选择记忆"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    {/* 内容按 markdown 渲染（可能是 markdown 数据；多行完整展示） */}
                    <div className="break-words text-foreground">
                      <Markdown content={m.content} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="rounded bg-muted px-1">{MEMORY_KIND_LABEL[m.kind]}</span>
                      <span className="rounded bg-muted px-1">{m.scope === "global" ? "全局" : "项目"}</span>
                      <span>把握 {m.confidence}</span>
                      {m.source_session_id && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/sessions?session=${m.source_session_id}`);
                          }}
                          className="text-primary hover:underline"
                          title="回跳来源会话"
                        >
                          来源会话 →
                        </button>
                      )}
                    </div>
                  </div>
                  {!selectMode && (
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button variant="ghost" size="xs" onClick={() => setEditing(m)}>
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void remove(m)}
                      >
                        删除
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </Virtualizer>
        )}
      </div>

      {/* 批量操作栏（多选模式浮现） */}
      {selectMode && (
        <div className="mt-2 flex shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
          <span className="text-muted-foreground">已选 {selected.size} 条</span>
          <Button
            variant="ghost"
            size="xs"
            disabled={selected.size === 0}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => void batchDelete()}
          >
            删除所选
          </Button>
          <Button variant="ghost" size="xs" className="ml-auto" onClick={exitSelect}>
            退出多选
          </Button>
        </div>
      )}

      {/* 编辑记忆（markdown 编辑器：源码 + 预览） */}
      <MemoryEditDialog
        open={editing !== null}
        defaultValue={editing?.content ?? ""}
        onResult={saveEdit}
      />
    </div>
  );
}
