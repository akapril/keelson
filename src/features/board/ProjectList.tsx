import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useBoardStore } from "../../store/board";
import { useSessionsStore } from "../../store/sessions";
import { useRestoreStore } from "../../store/restore";
import { ipc } from "@/lib/tauri/ipc";
import { providerLabel } from "@/lib/providers";
import type { Session } from "../../types/session";
import { listAllTasks, listAllStates } from "../../lib/pb/board";
import { listAllDocs } from "../../lib/pb/docs";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { BoardProject } from "../../types/board";
import { HugeiconsIcon } from "@hugeicons/react";
import { StarIcon } from "@hugeicons/core-free-icons";

/** 复制文本到剪贴板 + 反馈（调用者传入已翻译的 label 和错误文案） */
export function copyText(text: string, successMsg: string, errorMsg: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(successMsg),
    () => toast.error(errorMsg),
  );
}

// 单项目统计（用于卡片展示）
interface ProjectStat {
  total: number;
  done: number;
  docs: number;
  sessions: number;
}

// 仓库路径末段（用于同名项目消歧）
function repoTail(path?: string): string {
  if (!path) return "";
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
function fmtDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return "";
  }
}

// ── 单个项目卡片 ────────────────────────────────────────────────
function ProjectCard({
  project,
  stat,
  duplicate,
  hint,
  latestSession,
}: {
  project: BoardProject;
  stat?: ProjectStat;
  /** 是否与其他项目同名（需展示消歧信息） */
  duplicate: boolean;
  /** 无描述时的兜底提示：扫描到的最近会话提示词（「在做什么」） */
  hint?: string;
  /** 该项目最近的会话（供「继续」一键续接；无会话则不显示） */
  latestSession?: Session;
}) {
  const { t, i18n } = useTranslation("board");
  const openProject = useBoardStore((s) => s.openProject);
  const updateProject = useBoardStore((s) => s.updateProject);
  // 收藏切换方法（Task 2 store 提供）
  const toggleProjectPin = useBoardStore((s) => s.toggleProjectPin);
  const restore = useRestoreStore((s) => s.restore);
  const handleOpen = () => void openProject(project.id);

  // 「新终端」默认用该项目最近会话的 provider（无则 claude），避免再让用户选
  const newProvider = latestSession?.provider ?? "claude";

  // 一键续接最近会话：直接开（新终端窗，跳过选窗口/标签弹窗）。治「入口太深」。
  const handleResume = async () => {
    if (!latestSession) return;
    await restore(latestSession, false);
    const err = useRestoreStore.getState().error;
    if (err) toast.error(t("project.toast.resumeError", { msg: err }));
  };

  // 在项目目录新建会话（provider 默认最近用的）
  const handleNewTerminal = () => {
    if (!project.repo_path) return;
    void ipc
      .startSession(newProvider, project.repo_path)
      .then(() =>
        toast.success(t("sessions.toast.startSuccess", { provider: providerLabel(newProvider) })),
      )
      .catch((e) => toast.error(t("sessions.toast.startError", { msg: String(e) })));
  };

  // 悬停快捷动作按钮样式（同收藏星标：默认淡出，卡片 hover 才显；点击不冒泡到打开）
  const quickBtnCls =
    "shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring";

  const total = stat?.total ?? 0;
  const done = stat?.done ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const card = (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleOpen();
      }}
      className="group flex cursor-pointer flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-border hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {/* 名称 + 归档 */}
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-sm font-medium text-foreground" title={project.name}>
          {project.name}
        </span>
        {project.archived && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {t("project.archived")}
          </span>
        )}
        {/* 悬停快捷：一键续接最近会话 / 项目目录新建终端 —— 从项目列表直达，不必钻进会话 tab */}
        {latestSession && (
          <button
            type="button"
            title={t("project.continueTitle", { provider: latestSession.provider })}
            onClick={(e) => {
              e.stopPropagation();
              void handleResume();
            }}
            className={quickBtnCls}
          >
            {t("project.continueBtn")}
          </button>
        )}
        {project.repo_path && (
          <button
            type="button"
            title={t("project.newTerminalTitle", { provider: providerLabel(newProvider) })}
            onClick={(e) => {
              e.stopPropagation();
              handleNewTerminal();
            }}
            className={quickBtnCls}
          >
            {t("project.newTerminalBtn")}
          </button>
        )}
        {/* 收藏星标：已收藏常亮(primary)，未收藏淡显、卡片 hover 才出；点击不触发打开 */}
        <button
          type="button"
          aria-label={project.pinned ? t("project.pinBtn.unpin") : t("project.pinBtn.pin")}
          title={project.pinned ? t("project.pinBtn.unpin") : t("project.pinBtn.pin")}
          onClick={(e) => {
            e.stopPropagation();
            void toggleProjectPin(project.id).catch((err) =>
              toast.error(t("project.toast.pinError", { msg: String(err) })),
            );
          }}
          className={[
            "shrink-0 rounded p-0.5 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring",
            project.pinned
              ? "text-primary opacity-100"
              : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground",
          ].join(" ")}
        >
          <HugeiconsIcon icon={StarIcon} size={16} strokeWidth={2} />
        </button>
      </div>

      {/* 「这个项目是做什么的」：优先项目描述；无则用扫描到的最近会话提示词兜底 */}
      {project.description ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {project.description}
        </p>
      ) : hint ? (
        <p className="line-clamp-2 text-xs italic leading-relaxed text-muted-foreground/80">
          {t("project.latestHint", { text: hint })}
        </p>
      ) : (
        <p className="text-xs italic text-muted-foreground/50">{t("project.noDesc")}</p>
      )}

      {/* 消歧信息：仓库路径 + 创建日期（同名项目务必显示以区分） */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {project.repo_path ? (
          <span className="truncate font-mono" title={project.repo_path}>
            {duplicate ? project.repo_path : repoTail(project.repo_path)}
          </span>
        ) : (
          <span className="italic">{t("project.noRepo")}</span>
        )}
        <span className="ml-auto shrink-0">{fmtDate(project.created, i18n.language)}</span>
      </div>

      {/* 进度条（完成/总任务） */}
      <div className="mt-0.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* 计数：任务 done/total · 文档 · 会话 */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
        <span>{t("project.taskCount", { done, total })}</span>
        <span>{t("project.docCount", { count: stat?.docs ?? 0 })}</span>
        <span>{t("project.sessionCount", { count: stat?.sessions ?? 0 })}</span>
      </div>
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={handleOpen}>{t("project.ctxMenu.open")}</ContextMenuItem>
        {project.repo_path && (
          <ContextMenuItem onSelect={() => copyText(
            project.repo_path!,
            t("project.toast.copySuccess", { label: t("projectSheet.fieldRepo") }),
            t("common:state.error"),
          )}>
            {t("project.ctxMenu.copyRepoPath")}
          </ContextMenuItem>
        )}
        {/* 收藏/取消收藏：文案随当前状态切换 */}
        <ContextMenuItem
          onSelect={() =>
            void toggleProjectPin(project.id).catch((e) =>
              toast.error(t("project.toast.pinError", { msg: String(e) })),
            )
          }
        >
          {project.pinned ? t("project.ctxMenu.unpin") : t("project.ctxMenu.pin")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() =>
            void updateProject(project.id, { archived: !project.archived }).catch(
              (e) => toast.error(t("project.toast.archiveError", { msg: String(e) })),
            )
          }
        >
          {project.archived ? t("project.ctxMenu.unarchive") : t("project.ctxMenu.archive")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── 项目列表组件 ────────────────────────────────────────────────
export function ProjectList({ showArchived = false }: { showArchived?: boolean }) {
  const { t } = useTranslation("board");
  const allProjects = useBoardStore((s) => s.projects);
  const loading = useBoardStore((s) => s.loading);
  const error = useBoardStore((s) => s.error);
  const sessions = useSessionsStore((s) => s.sessions);

  // 默认隐藏已归档项目（板面清爽）；「显示归档」开关打开时才展示
  const projects = showArchived ? allProjects : allProjects.filter((p) => !p.archived);

  const [stats, setStats] = useState<Record<string, ProjectStat>>({});

  // 拉全部任务/状态/文档，聚合每个项目的统计（非阻塞卡片渲染）。
  // 触发时机：挂载、项目增删（projects.length 变化）、以及窗口重新聚焦——
  // 覆盖「在别处/别的窗口改了任务或文档（Spotlight 建任务 / ⌘K / 后台同步）后
  // 回到已挂载的首页，卡片统计不刷新」的陈旧问题（sessionCount 走 store 实时，
  // 只有 task/doc 计数需要在此主动重拉）。
  useEffect(() => {
    let cancelled = false;
    const loadStats = async () => {
      try {
        const [tasks, states, docs] = await Promise.all([
          listAllTasks(),
          listAllStates(),
          listAllDocs(),
        ]);
        if (cancelled) return;
        // state_id → 是否「完成」类别
        const doneState = new Set(
          states.filter((s) => s.category === "completed").map((s) => s.id),
        );
        const map: Record<string, ProjectStat> = {};
        const ensure = (pid: string) =>
          (map[pid] ??= { total: 0, done: 0, docs: 0, sessions: 0 });
        for (const t of tasks) {
          // 归档任务不计入项目卡片统计（与看板默认隐藏归档一致）
          if (t.archived) continue;
          const st = ensure(t.project);
          st.total += 1;
          if (doneState.has(t.state)) st.done += 1;
        }
        // 多对多：文档计入其每个关联项目
        for (const d of docs) for (const pid of d.projects ?? []) ensure(pid).docs += 1;
        setStats(map);
      } catch {
        /* 统计失败不影响卡片基本展示 */
      }
    };
    void loadStats();
    // 窗口重新聚焦时重拉，保持首页统计新鲜（返回应用/切回主窗时触发）
    const onFocus = () => void loadStats();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [projects.length]);

  // 会话数按 repo_path 匹配（来自会话中枢缓存）
  const sessionCount = (repoPath?: string) =>
    repoPath ? sessions.filter((s) => s.project_path === repoPath).length : 0;

  // 最近会话提示词（扫描到的「在做什么」，无项目描述时兜底展示）
  const latestPrompt = (repoPath?: string): string => {
    if (!repoPath) return "";
    const list = sessions.filter((s) => s.project_path === repoPath);
    if (list.length === 0) return "";
    const latest = list.reduce((a, b) => (a.updated_at > b.updated_at ? a : b));
    return (latest.last_prompt || latest.first_prompt || "").trim();
  };

  // 该项目最近的会话对象（供卡片「继续」一键续接）
  const latestSessionOf = (repoPath?: string): Session | undefined => {
    if (!repoPath) return undefined;
    const list = sessions.filter((s) => s.project_path === repoPath);
    if (list.length === 0) return undefined;
    return list.reduce((a, b) => (a.updated_at > b.updated_at ? a : b));
  };

  // 同名检测（用于消歧显示）
  const nameCounts = projects.reduce<Record<string, number>>((acc, p) => {
    acc[p.name] = (acc[p.name] ?? 0) + 1;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        {t("common:state.loading")}
      </div>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        {error}
      </div>
    );
  }
  if (projects.length === 0) {
    // 区分「真无项目」与「都被归档隐藏了」
    const allArchived = allProjects.length > 0;
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
        <span>{allArchived ? t("project.list.allArchived") : t("project.list.empty")}</span>
        <span className="text-xs">
          {allArchived
            ? t("project.list.allArchivedHint")
            : t("project.list.emptyHint")}
        </span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => {
        const stat = stats[project.id];
        return (
          <ProjectCard
            key={project.id}
            project={project}
            duplicate={(nameCounts[project.name] ?? 0) > 1}
            hint={latestPrompt(project.repo_path)}
            latestSession={latestSessionOf(project.repo_path)}
            stat={{
              total: stat?.total ?? 0,
              done: stat?.done ?? 0,
              docs: stat?.docs ?? 0,
              sessions: sessionCount(project.repo_path),
            }}
          />
        );
      })}
    </div>
  );
}
