// 记忆账本 —— 查看/筛选/编辑/删除跨厂商提炼的记忆；每条可溯源回跳原会话。
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { listMemories, updateMemoryRecord, deleteMemoryRecord } from "@/lib/pb/memory";
import { MEMORY_KIND_LABEL, type Memory, type MemoryKind } from "@/types/memory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PromptDialog } from "@/components/prompt-dialog";
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
        (kind === "all" || m.kind === kind) &&
        (scope === "all" || m.scope === scope) &&
        (!q || m.content.toLowerCase().includes(q)),
    );
  }, [memories, kind, scope, query]);

  const remove = async (m: Memory) => {
    setMemories((prev) => prev.filter((x) => x.id !== m.id));
    try {
      await deleteMemoryRecord(m.id);
    } catch (e) {
      toast.error(`删除失败：${String(e)}`);
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
          <div className="flex flex-col gap-1.5">
            {visible.map((m) => (
              <div key={m.id} className="group flex items-start gap-2.5 rounded-lg border border-border bg-card p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{m.content}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="rounded bg-muted px-1">{MEMORY_KIND_LABEL[m.kind]}</span>
                    <span className="rounded bg-muted px-1">{m.scope === "global" ? "全局" : "项目"}</span>
                    <span>把握 {m.confidence}</span>
                    {m.source_session_id && (
                      <button
                        type="button"
                        onClick={() => navigate(`/sessions?session=${m.source_session_id}`)}
                        className="text-primary hover:underline"
                        title="回跳来源会话"
                      >
                        来源会话 →
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button variant="ghost" size="xs" onClick={() => setEditing(m)}>
                    编辑
                  </Button>
                  <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-destructive" onClick={() => void remove(m)}>
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 编辑记忆（复用 PromptDialog） */}
      <PromptDialog
        open={editing !== null}
        title="编辑记忆"
        label="记忆内容"
        defaultValue={editing?.content ?? ""}
        confirmText="保存"
        allowEmpty={false}
        onResult={saveEdit}
      />
    </div>
  );
}
