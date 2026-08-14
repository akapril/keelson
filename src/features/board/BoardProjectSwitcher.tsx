// BoardProjectSwitcher —— 板顶项目切换器：下拉列项目（收藏优先 + 搜索），选中在板内切换（openProject），不跳转不回选择墙。
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { useBoardStore } from "@/store/board";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function BoardProjectSwitcher() {
  const { t } = useTranslation("board");
  const projects = useBoardStore((s) => s.projects);
  const openedProjectId = useBoardStore((s) => s.openedProjectId);
  const openProject = useBoardStore((s) => s.openProject);
  const [q, setQ] = useState("");

  const current = projects.find((p) => p.id === openedProjectId);
  // 收藏(pinned)优先，其次按 updated 倒序；再按搜索词过滤
  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return [...projects]
      .filter((p) => !kw || p.name.toLowerCase().includes(kw))
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return (b.updated || "").localeCompare(a.updated || "");
      });
  }, [projects, q]);

  return (
    <DropdownMenu onOpenChange={(o) => { if (!o) setQ(""); }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <span className="max-w-[12rem] truncate">{current?.name ?? t("switcher.pick")}</span>
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 p-0">
        <div className="p-1.5">
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("switcher.searchPlaceholder")}
            className="h-8 text-sm"
          />
        </div>
        <div className="max-h-72 overflow-y-auto pb-1">
          {list.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t("switcher.noMatch")}</p>
          )}
          {list.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onSelect={() => { if (p.id !== openedProjectId) void openProject(p.id); }}
              className={cn("mx-1 gap-2", p.id === openedProjectId && "bg-accent text-accent-foreground")}
            >
              {p.pinned && <span className="text-amber-500">★</span>}
              <span className="truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
