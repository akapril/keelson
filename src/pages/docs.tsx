// 全局「文档」页 —— 跨项目汇总所有文档：搜索（标题+正文）+ 按项目分组 + 点击深链直达。
// 文档仍归属项目，此页仅提供聚合浏览入口。创建/编辑仍在项目工作台「文档」tab。
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { File01Icon } from "@hugeicons/core-free-icons";

import { Input } from "@/components/ui/input";
import { listAllDocs } from "@/lib/pb/docs";
import { listProjects } from "@/lib/pb/board";
import { workspaceRecordUrl } from "@/lib/workspace-navigation";
import type { BoardDoc } from "@/types/docs";
import type { BoardProject } from "@/types/board";

/** 取正文中命中词附近的一段作为预览（无命中取开头）。 */
function snippet(content: string, q: string): string {
  if (!content) return "";
  const flat = content.replace(/\s+/g, " ").trim();
  const i = q ? flat.toLowerCase().indexOf(q) : -1;
  if (i < 0) return flat.slice(0, 80);
  const start = Math.max(0, i - 24);
  return (start > 0 ? "…" : "") + flat.slice(start, start + 90) + "…";
}

export default function DocsPage() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<BoardDoc[]>([]);
  const [projects, setProjects] = useState<BoardProject[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void listAllDocs().then(setDocs).catch(() => {});
    void listProjects().then(setProjects).catch(() => {});
  }, []);

  const projectName = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? docs.filter(
            (d) =>
              (d.title || "").toLowerCase().includes(q) ||
              (d.content || "").toLowerCase().includes(q),
          )
        : docs,
    [docs, q],
  );

  // 按项目分组（组内按 updated 降序）
  const groups = useMemo(() => {
    const map = new Map<string, BoardDoc[]>();
    for (const d of filtered) {
      const arr = map.get(d.project) ?? [];
      arr.push(d);
      map.set(d.project, arr);
    }
    for (const arr of map.values())
      arr.sort((a, b) => (b.updated > a.updated ? 1 : -1));
    return [...map.entries()];
  }, [filtered]);

  const open = (d: BoardDoc) =>
    navigate(workspaceRecordUrl("board", d.project, { tab: "docs", doc: d.id }));

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 p-6">
      <header className="shrink-0">
        <h1 className="text-lg font-semibold">文档</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          跨项目汇总，搜索标题与正文；点击打开对应项目的文档。
        </p>
      </header>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索文档（标题 + 正文）…"
        className="shrink-0"
      />

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {docs.length === 0 ? "暂无文档" : "没有匹配的文档"}
          </p>
        ) : (
          groups.map(([projectId, list]) => (
            <section key={projectId}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {projectName.get(projectId) ?? "未知项目"}（{list.length}）
              </h2>
              <div className="flex flex-col gap-1.5">
                {list.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => open(d)}
                    className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40"
                  >
                    <HugeiconsIcon
                      icon={File01Icon}
                      strokeWidth={2}
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {d.title || "未命名文档"}
                      </span>
                      {d.content && (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                          {snippet(d.content, q)}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
