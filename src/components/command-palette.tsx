// 全局命令面板（⌘K / Ctrl+K）—— 跨页面/项目/会话/阅读的快速搜索跳转。
// cmdk 负责模糊过滤；打开时刷新项目/阅读数据，会话取自 store（空则触发加载）。
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Analytics01Icon } from "@hugeicons/core-free-icons";
import { flatNavItems } from "@/lib/navigation";
import { workspaceRecordUrl } from "@/lib/workspace-navigation";
import { listProjects } from "@/lib/pb/board";
import { listAllDocs } from "@/lib/pb/docs";
import { listReadingItems } from "@/lib/pb/reading";
import { useSessionsStore } from "@/store/sessions";
import type { BoardProject } from "@/types/board";
import type { BoardDoc } from "@/types/docs";
import type { ReadingItem } from "@/types/reading";

/** 取文档正文中命中词附近的一小段作为预览（无命中则取开头）。 */
function docSnippet(content: string, q: string): string {
  if (!content) return "";
  const flat = content.replace(/\s+/g, " ").trim();
  const i = q ? flat.toLowerCase().indexOf(q) : -1;
  if (i < 0) return flat.slice(0, 50);
  const start = Math.max(0, i - 20);
  return (start > 0 ? "…" : "") + flat.slice(start, start + 60) + "…";
}

export function CommandPalette() {
  const { t } = useTranslation("shell");
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<BoardProject[]>([]);
  const [docs, setDocs] = useState<BoardDoc[]>([]);
  const [reading, setReading] = useState<ReadingItem[]>([]);
  // 输入词（用于文档正文子串搜索；cmdk 对长文本的模糊匹配会误命中，故自行子串过滤）
  const [query, setQuery] = useState("");
  const sessions = useSessionsStore((s) => s.sessions);
  const navigate = useNavigate();

  // ⌘K / Ctrl+K 切换面板；也响应头部搜索按钮派发的自定义事件
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  // 打开时刷新可跳转的数据（失败静默，如集合尚未建）
  useEffect(() => {
    if (!open) return;
    void listProjects()
      .then(setProjects)
      .catch(() => {});
    void listAllDocs()
      .then(setDocs)
      .catch(() => {});
    void listReadingItems()
      .then(setReading)
      .catch(() => {});
    if (sessions.length === 0) void useSessionsStore.getState().load();
    setQuery(""); // 每次打开清空上次的搜索词
    // 仅在打开时刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const go = (url: string) => {
    setOpen(false);
    navigate(url);
  };

  // 文档按标题/正文子串匹配（有输入才搜；cmdk 模糊匹配长正文会误命中，故自行过滤）
  const q = query.trim().toLowerCase();
  const docMatches = q
    ? docs
        .filter(
          (d) =>
            (d.title || "").toLowerCase().includes(q) ||
            (d.content || "").toLowerCase().includes(q),
        )
        .slice(0, 20)
    : [];
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder={t("commandPalette.placeholder")}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{t("commandPalette.empty")}</CommandEmpty>

        <CommandGroup heading={t("commandPalette.groupActions")}>
          <CommandItem value="操作 生成工作报告 周报 日报" onSelect={() => go("/report")}>
            <HugeiconsIcon icon={Analytics01Icon} strokeWidth={2} className="size-4" />
            {t("commandPalette.actionReport")}
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading={t("commandPalette.groupPages")}>
          {flatNavItems.map((it) => (
            <CommandItem
              key={it.url}
              value={`页面 ${it.title}`}
              onSelect={() => go(it.url)}
            >
              <HugeiconsIcon icon={it.icon} strokeWidth={2} className="size-4" />
              {it.title}
            </CommandItem>
          ))}
        </CommandGroup>

        {projects.length > 0 && (
          <CommandGroup heading={t("commandPalette.groupProjects")}>
            {projects.map((p) => (
              <CommandItem
                key={p.id}
                value={`项目 ${p.name}`}
                onSelect={() => go(workspaceRecordUrl("board", p.id))}
              >
                {p.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {docMatches.length > 0 && (
          <CommandGroup heading={t("commandPalette.groupDocs")}>
            {docMatches.map((d) => (
              <CommandItem
                key={d.id}
                // value 含 query，确保 cmdk 不会按其模糊算法把已匹配项过滤掉
                value={`文档 ${query} ${d.title} ${d.id}`}
                onSelect={() =>
                  go(workspaceRecordUrl("board", d.projects[0] ?? "", { tab: "docs", doc: d.id }))
                }
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{d.title || t("commandPalette.unnamedDoc")}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {projectNameById.get(d.projects[0] ?? "") ?? t("commandPalette.docFallbackGroup")} · {docSnippet(d.content, q)}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {sessions.length > 0 && (
          <CommandGroup heading={t("commandPalette.groupSessions")}>
            {sessions.slice(0, 50).map((s) => (
              <CommandItem
                key={s.session_id}
                value={`会话 ${s.project_name} ${s.last_prompt} ${s.first_prompt}`}
                onSelect={() => go(`/sessions?session=${s.session_id}`)}
              >
                <span className="min-w-0 truncate">
                  {s.project_name} · {s.last_prompt || s.first_prompt || s.session_id}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {reading.length > 0 && (
          <CommandGroup heading={t("commandPalette.groupReading")}>
            {reading.map((r) => (
              <CommandItem
                key={r.id}
                value={`阅读 ${r.title}`}
                onSelect={() => go("/reading")}
              >
                <span className="min-w-0 truncate">{r.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
