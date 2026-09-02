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
import {
  Analytics01Icon,
  Sun02Icon,
  Settings02Icon,
  TerminalIcon,
  Search01Icon,
  Add01Icon,
} from "@hugeicons/core-free-icons";
import { format } from "date-fns";
import { toast } from "sonner";
import { flatNavItems } from "@/lib/navigation";
import { workspaceRecordUrl } from "@/lib/workspace-navigation";
import { listProjects, listAllTasks } from "@/lib/pb/board";
import { listAllDocs } from "@/lib/pb/docs";
import { listReadingItems } from "@/lib/pb/reading";
import { useSessionsStore } from "@/store/sessions";
import { useSessionSearchStore } from "@/store/session-search";
import { useCalendarStore } from "@/store/calendar";
import { parseQuickLog, DEFAULT_EVENT_COLOR } from "@/lib/calendar/quick-log";
import { useReportJobStore } from "@/store/report-job";
import { useSettingsStore } from "@/store/settings";
import { computeRange } from "@/features/report/report-range";
import { useRestoreStore } from "@/store/restore";
import { useTheme } from "@/components/theme-provider";
import { getMru, pushMru } from "@/components/command-mru";
import type { BoardProject, BoardTask } from "@/types/board";
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
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [docs, setDocs] = useState<BoardDoc[]>([]);
  const [reading, setReading] = useState<ReadingItem[]>([]);
  // 输入词（用于文档正文子串搜索；cmdk 对长文本的模糊匹配会误命中，故自行子串过滤）
  const [query, setQuery] = useState("");
  const sessions = useSessionsStore((s) => s.sessions);
  const navigate = useNavigate();
  const resume = useRestoreStore((s) => s.resume);
  const { theme, setTheme } = useTheme();

  // 最近项 MRU：仅在打开且无输入时展示（快速切换器）。打开时读一次快照，避免每帧读 localStorage。
  const [mru, setMru] = useState(getMru);
  useEffect(() => {
    if (open) setMru(getMru());
  }, [open]);

  // 「继续上次会话」：接续 updated_at 最新的一条（一键，走全局新窗/标签偏好）
  const latestSession =
    sessions.length > 0
      ? sessions.reduce((a, b) =>
          Date.parse(b.updated_at) > Date.parse(a.updated_at) ? b : a,
        )
      : null;
  const resumeLast = () => {
    if (!latestSession) return;
    setOpen(false);
    void resume(latestSession);
  };

  // 切换明暗主题（与头部 ThemeToggle 同逻辑：system 也按当前解析结果翻到对立面）
  const toggleTheme = () => {
    const isDark =
      theme === "dark" ||
      (theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    setTheme(isDark ? "light" : "dark");
    setOpen(false);
  };

  // ⌘K 里「记一笔」：用当前输入词、以此刻在今天建一条日历事件（解析 @项目 关联），不用切到日历页
  const quickLog = async () => {
    const text = query.trim();
    if (!text) return;
    const { title, project } = parseQuickLog(text, projects);
    if (!title) return;
    setOpen(false);
    try {
      await useCalendarStore.getState().addEvent({
        title,
        project,
        start: format(new Date(), "yyyy-MM-dd"),
        start_time: format(new Date(), "HH:mm"),
        all_day: false,
        color: DEFAULT_EVENT_COLOR,
      });
      toast.success(t("commandPalette.quickLogDone", { text: title }));
    } catch (e) {
      toast.error(String(e));
    }
  };

  // ⌘K 一键「今天回顾」：以今天为范围后台生成 AI 日报（复用 report-job），跳报告页看进度/结果
  const todayReview = () => {
    const cfg = useSettingsStore.getState().aiConfig;
    const isCli = cfg.provider === "claude-cli" || cfg.provider === "codex-cli";
    setOpen(false);
    if (!isCli && !cfg.api_key) {
      // 未配置 AI：跳报告页让用户配置，不静默失败
      navigate("/report");
      return;
    }
    useReportJobStore.getState().run({
      range: computeRange("today", new Date()),
      scope: "all",
      cfg,
    });
    toast.message(t("commandPalette.todayReviewStarted"));
    navigate("/report");
  };

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
    void listAllTasks()
      .then(setTasks)
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

  // 跳转；传 label 时记入 MRU（对象类跳转——项目/文档/会话/页面——才记，纯动作不记）
  const go = (url: string, label?: string) => {
    setOpen(false);
    if (label) pushMru({ url, label });
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
  // 任务按标题子串匹配（仅有输入时；任务多、空查询全列会刷屏）——命中直达其项目看板
  const taskMatches = q
    ? tasks.filter((tk) => (tk.title || "").toLowerCase().includes(q)).slice(0, 20)
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
          {/* value 随语言对齐可见文本，确保英文模式下关键词可搜到。仅收「无上下文歧义」动作 */}
          {/* 记一笔：有输入时置顶，用输入词以此刻在今天建一条日历事件（支持 @项目） */}
          {q && (
            <CommandItem value={`quick-log ${query}`} onSelect={quickLog}>
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4" />
              {t("commandPalette.actionQuickLog", { q: query.trim() })}
            </CommandItem>
          )}
          {latestSession && (
            <CommandItem
              value={t("commandPalette.actionResumeLast")}
              onSelect={resumeLast}
            >
              <HugeiconsIcon icon={TerminalIcon} strokeWidth={2} className="size-4" />
              {t("commandPalette.actionResumeLast")}
            </CommandItem>
          )}
          <CommandItem value={t("commandPalette.actionTodayReview")} onSelect={todayReview}>
            <HugeiconsIcon icon={Analytics01Icon} strokeWidth={2} className="size-4" />
            {t("commandPalette.actionTodayReview")}
          </CommandItem>
          <CommandItem value={t("commandPalette.actionReport")} onSelect={() => go("/report")}>
            <HugeiconsIcon icon={Analytics01Icon} strokeWidth={2} className="size-4" />
            {t("commandPalette.actionReport")}
          </CommandItem>
          <CommandItem value={t("commandPalette.actionToggleTheme")} onSelect={toggleTheme}>
            <HugeiconsIcon icon={Sun02Icon} strokeWidth={2} className="size-4" />
            {t("commandPalette.actionToggleTheme")}
          </CommandItem>
          <CommandItem value={t("commandPalette.actionSettings")} onSelect={() => go("/settings")}>
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} className="size-4" />
            {t("commandPalette.actionSettings")}
          </CommandItem>
          <CommandItem value={t("commandPalette.actionMcp")} onSelect={() => go("/settings?section=mcp")}>
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} className="size-4" />
            {t("commandPalette.actionMcp")}
          </CommandItem>
        </CommandGroup>

        {/* 最近项：仅无输入时展示（快速切换器）；有输入时交给各分组模糊搜 */}
        {!q && mru.length > 0 && (
          <CommandGroup heading={t("commandPalette.groupRecent")}>
            {mru.map((e) => (
              <CommandItem
                key={e.url}
                value={`recent ${e.label}`}
                onSelect={() => go(e.url, e.label)}
              >
                <span className="min-w-0 truncate">{e.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading={t("commandPalette.groupPages")}>
          {flatNavItems.map((it) => {
            const title = t(it.titleKey);
            return (
              <CommandItem
                key={it.url}
                value={`${t("commandPalette.groupPages")} ${title}`}
                onSelect={() => go(it.url, title)}
              >
                <HugeiconsIcon icon={it.icon} strokeWidth={2} className="size-4" />
                {title}
              </CommandItem>
            );
          })}
        </CommandGroup>

        {projects.length > 0 && (
          <CommandGroup heading={t("commandPalette.groupProjects")}>
            {projects.map((p) => (
              <CommandItem
                key={p.id}
                value={`${t("commandPalette.groupProjects")} ${p.name}`}
                onSelect={() => go(workspaceRecordUrl("board", p.id), p.name)}
              >
                {p.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {taskMatches.length > 0 && (
          <CommandGroup heading={t("commandPalette.groupTasks")}>
            {taskMatches.map((tk) => (
              <CommandItem
                key={tk.id}
                value={`${t("commandPalette.groupTasks")} ${query} ${tk.title} ${tk.id}`}
                onSelect={() => go(workspaceRecordUrl("board", tk.project), tk.title)}
              >
                <span className="min-w-0 flex-1 truncate">{tk.title}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                  {projectNameById.get(tk.project) ?? ""}
                </span>
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
                value={`${t("commandPalette.groupDocs")} ${query} ${d.title} ${d.id}`}
                onSelect={() =>
                  go(
                    workspaceRecordUrl("board", d.projects[0] ?? "", { tab: "docs", doc: d.id }),
                    d.title || t("commandPalette.unnamedDoc"),
                  )
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
                value={`${t("commandPalette.groupSessions")} ${s.project_name} ${s.last_prompt} ${s.first_prompt}`}
                onSelect={() =>
                  go(
                    `/sessions?session=${s.session_id}`,
                    `${s.project_name} · ${s.last_prompt || s.first_prompt || s.session_id}`,
                  )
                }
              >
                <span className="min-w-0 truncate">
                  {s.project_name} · {s.last_prompt || s.first_prompt || s.session_id}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* 会话深搜桥：⌘K 只匹配会话首尾提示，聊到一半的内容搜不到；
            有输入时给一条「在会话正文深搜」→ 跳 /sessions 触发既有 RAG/全文检索 */}
        {q && (
          <CommandGroup heading={t("commandPalette.groupSessions")}>
            <CommandItem
              value={`session-deep-search ${query}`}
              onSelect={() => {
                setOpen(false);
                useSessionSearchStore.getState().run(query.trim());
                navigate("/sessions");
              }}
            >
              <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="size-4" />
              {t("commandPalette.sessionDeepSearch", { q: query.trim() })}
            </CommandItem>
          </CommandGroup>
        )}

        {reading.length > 0 && (
          <CommandGroup heading={t("commandPalette.groupReading")}>
            {reading.map((r) => (
              <CommandItem
                key={r.id}
                value={`${t("commandPalette.groupReading")} ${r.title}`}
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
