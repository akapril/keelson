// 全局命令面板（⌘K / Ctrl+K）—— 跨页面/项目/会话/阅读的快速搜索跳转。
// cmdk 负责模糊过滤；打开时刷新项目/阅读数据，会话取自 store（空则触发加载）。
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { flatNavItems } from "@/lib/navigation";
import { workspaceRecordUrl } from "@/lib/workspace-navigation";
import { listProjects } from "@/lib/pb/board";
import { listReadingItems } from "@/lib/pb/reading";
import { useSessionsStore } from "@/store/sessions";
import type { BoardProject } from "@/types/board";
import type { ReadingItem } from "@/types/reading";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<BoardProject[]>([]);
  const [reading, setReading] = useState<ReadingItem[]>([]);
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
    void listReadingItems()
      .then(setReading)
      .catch(() => {});
    if (sessions.length === 0) void useSessionsStore.getState().load();
    // 仅在打开时刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const go = (url: string) => {
    setOpen(false);
    navigate(url);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="搜索页面 / 项目 / 会话 / 阅读…" />
      <CommandList>
        <CommandEmpty>无结果</CommandEmpty>

        <CommandGroup heading="页面">
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
          <CommandGroup heading="项目">
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

        {sessions.length > 0 && (
          <CommandGroup heading="会话">
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
          <CommandGroup heading="阅读">
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
