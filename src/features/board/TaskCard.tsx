// TaskCard —— 看板单任务卡片（视觉移植自 workavera todo-card，绑定我们的 store/类型）。
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar03Icon,
  TextAlignLeftIcon,
  Message01Icon,
  CheckmarkCircle02Icon,
  CircleIcon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { stripMarkdown } from "@/lib/markdown-preview";
import { statusTone } from "@/lib/status-tone";
import { useBoardStore } from "@/store/board";
import type { BoardTask, BoardLabel, BoardState } from "@/types/board";
import { PRIORITY_META, PRIORITY_ORDER } from "./board-meta";
import { isCliSynced, toggleInject, getInjectSet } from "./cli-task-source";
import { ipc } from "@/lib/tauri/ipc";
import { listAgentRuns } from "@/lib/pb/agent-runs";
import type { AgentRun } from "@/types/agent";
import { providerLabel } from "@/lib/providers";
import { AgentRunPanel } from "./AgentRunPanel";
import { useAgentLogStore } from "@/store/agent-run-logs";
import { useAgentStore } from "@/store/agents";
import { listen } from "@tauri-apps/api/event";

// 运行状态徽标的样式映射（cls 走 statusTone 单一色调映射，不再内联复刻颜色公式）。
const RUN_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  running: { label: "执行中", cls: statusTone("info").chip },
  review:  { label: "待审",   cls: statusTone("warning").chip },
  blocked: { label: "受阻",   cls: statusTone("danger").chip },
};

// 「已入队」徽标（任务已指派 agent 但 worker 尚未开跑时显示）。
const ENQUEUED_BADGE = { label: "已入队", cls: statusTone("neutral").chip };

// ── 日期格式化 ────────────────────────────────────────────────
function formatDate(dateStr: string, locale: string): string {
  return new Date(dateStr).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

function isOverdue(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr) < today;
}

interface TaskCardProps {
  task: BoardTask;
  /** 全部标签（由父列 StatusColumn 订阅一次后传入，避免每卡各订阅整个 labels 数组）。 */
  labels: BoardLabel[];
  /** 全部状态列（同上，供右键"移动到"子菜单；父列订阅一次传入）。 */
  states: BoardState[];
  /** 点击卡片进入编辑（拖拽激活距离 6px，纯点击不会触发拖拽）。 */
  onEdit?: (task: BoardTask) => void;
  /** 当前是否处于多选模式。 */
  selectMode?: boolean;
  /** 当前卡片是否被选中（多选模式下）。 */
  selected?: boolean;
  /** 切换本卡片勾选状态（多选模式下点击卡片触发）。 */
  onToggleSelect?: (taskId: string) => void;
  /** 进入多选模式（右键菜单"选择"项触发）。 */
  onEnterSelect?: (taskId: string) => void;
  /** 点击运行状态徽标（Task 10 实现 run 面板时传入；本 Task 仅留占位，不强制）。 */
  onRunClick?: (run: AgentRun) => void;
}

/**
 * 可拖拽任务卡片：标签 chip / 标题 / 描述指示 / 优先级徽章 / 截止日期 / 来源会话徽章。
 * inline style 仅用于用户数据颜色（label.color）与 dnd transform。
 * 多选模式：左上角勾选框 + 点击切换勾选（不打开编辑）；拖拽禁用。
 */
function TaskCardInner({
  task,
  labels,
  states,
  onEdit,
  selectMode = false,
  selected = false,
  onToggleSelect,
  onEnterSelect,
  onRunClick,
}: TaskCardProps) {
  // labels/states 改由父列传入（不再每卡各订阅整个数组）；
  // 仅保留下面几个稳定函数 selector（返回同一引用，求值代价可忽略）。
  const updateTask = useBoardStore((s) => s.updateTask);
  const deleteTask = useBoardStore((s) => s.deleteTask);
  const restoreTask = useBoardStore((s) => s.restoreTask);
  const moveTask = useBoardStore((s) => s.moveTask);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("board");

  // ── S2：命名队友列表（全局 store 懒加载一次）──────────────────────────────
  const agentStoreLoad = useAgentStore((s) => s.load);
  const allAgents = useAgentStore((s) => s.agents);
  // 过滤出活跃队友（未归档、未软删）用于指派下拉
  const activeAgents = useMemo(
    () => allAgents.filter((a) => !a.archived && !a.deleted_at),
    [allAgents],
  );

  // 是否正在执行（防重复点击）
  const [agentRunning, setAgentRunning] = useState(false);
  // Agent Run 面板受控开关（点击运行徽标打开）
  const [runPanelOpen, setRunPanelOpen] = useState(false);

  // ── 运行状态徽标：挂载时拉最新一条 run ──────────────────────────────────
  const [latestRun, setLatestRun] = useState<AgentRun | null>(null);
  // 用 ref 存 taskId 防止闭包过时（task prop 引用会变）
  const taskIdRef = useRef(task.id);
  taskIdRef.current = task.id;

  useEffect(() => {
    let cancelled = false;
    listAgentRuns(task.id)
      .then((runs) => {
        if (!cancelled) {
          // 取最新一条（sort=-started，首项最新）
          setLatestRun(runs[0] ?? null);
        }
      })
      .catch(() => {
        // 拉取失败不影响卡片主体展示，静默忽略
      });
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  // 订阅后台 worker 的 run 变更事件：仅当事件负载是本任务 id 时重新拉最新 run 刷新徽标。
  useEffect(() => {
    let cancelled = false;
    const un = listen<string>("agent-run-changed", (e) => {
      if (cancelled || e.payload !== task.id) return;
      listAgentRuns(task.id)
        .then((runs) => {
          if (!cancelled) setLatestRun(runs[0] ?? null);
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
      void un.then((f) => f());
    };
  }, [task.id]);

  // 确保队友列表已加载（全局幂等，load 函数内部若已 loaded 可由 store 层自行处理）
  useEffect(() => {
    void agentStoreLoad();
  }, [agentStoreLoad]);

  /** 发起 Agent 执行（S2）：传队友 id 作 agentRef 调用 IPC，done 后刷新徽标，错误重抛并 toast */
  const runWithAgent = async (agentId: string, agentName: string) => {
    if (agentRunning) return;
    // 发起前清空旧日志，避免上次执行的内容残留
    useAgentLogStore.getState().reset(task.id);
    setAgentRunning(true);
    try {
      // S2：agentRef 传队友 id（Rust 侧 resolve_agent 按 id 查队友，再取 provider）
      await ipc.agentRunTask(task.id, agentId, (e) => {
        if (e.kind === "delta" && e.text) {
          // 增量文本：写入实时日志 store，面板会订阅并实时渲染
          useAgentLogStore.getState().append(task.id, e.text);
        } else if (e.kind === "done") {
          // 执行完毕：toast 成功 + 刷新徽标
          toast.success(`${agentName} 已完成任务「${task.title}」`);
          listAgentRuns(taskIdRef.current)
            .then((runs) => setLatestRun(runs[0] ?? null))
            .catch(() => undefined);
        }
      });
    } catch (err) {
      toast.error(`Agent 执行失败：${String(err)}`);
      // 重抛，确保调用方 catch 能感知错误（不吞）
      throw err;
    } finally {
      setAgentRunning(false);
    }
  };

  /** 指派命名队友（S2）：写 agent_id + agent_enqueued=true，交由后台 worker 领取执行。 */
  const assignAgent = async (agentId: string, agentName: string) => {
    try {
      await updateTask(task.id, { agent_id: agentId, agent_enqueued: true });
      toast.success(t("agent.assigned", { name: agentName }));
    } catch (e) {
      // updateTask 失败已回滚，这里 toast 让用户知情（不吞错）
      toast.error(t("agent.assignError", { msg: String(e) }));
    }
  };

  // 运行状态徽标（running/review/blocked 时显示；其余终态不显示）
  const runBadge = latestRun ? RUN_STATUS_BADGE[latestRun.status] : null;

  // 已入队但还没有非终态 run 时，显示「已入队」徽标（worker 领取后会转为「执行中」）。
  const showEnqueued =
    !!task.agent_enqueued &&
    !(latestRun && ["running", "review", "blocked"].includes(latestRun.status));

  // S2：已指派命名队友时显示队友徽标；否则回退旧 provider 显示逻辑
  // 徽标查询用完整列表（含归档/软删），避免队友归档后徽标消失
  // 注意：指派下拉仍用 activeAgents（只允许指派活跃队友）
  const assignedAgent = task.agent_id
    ? allAgents.find((a) => a.id === task.agent_id) ?? null
    : null;

  // 已有活动 run（执行中/待审/受阻）或已入队时，禁止再次「指派」，
  // 避免自动重派覆盖未审结果（spec §防手滑）。
  // 「立即跑一次」（runNowWith）是刻意的逃生门，始终保持可用。
  const assignLocked =
    !!task.agent_enqueued ||
    (!!latestRun && ["running", "review", "blocked"].includes(latestRun.status));

  // 右键菜单：改优先级（同优先级不重复写）
  const setPriority = (p: BoardTask["priority"]) => {
    if (p === task.priority) return;
    void updateTask(task.id, { priority: p }).catch((e) =>
      toast.error(t("task.toast.priorityError", { msg: String(e) })),
    );
  };
  // 右键菜单：移动到目标状态列（追加到末尾）
  const moveTo = (stateId: string) => {
    if (stateId === task.state) return;
    // 点击时按需读一次 tasks（getState 非订阅），避免每张卡订阅整个 tasks 数组
    // 导致任一任务变动全体卡片重渲。
    const toIndex = useBoardStore
      .getState()
      .tasks.filter((tk) => tk.state === stateId).length;
    void moveTask(task.id, stateId, toIndex).catch((e) =>
      toast.error(t("task.toast.moveError", { msg: String(e) })),
    );
  };
  // 右键菜单：删除（软删）。成功后弹带「撤销」的 toast——6 秒内可反写 deleted_at 恢复。
  const remove = () => {
    const snapshot = task; // 留存供撤销回插（软删只置 deleted_at，记录仍在）
    void deleteTask(task.id)
      .then(() =>
        toast.success(t("task.toast.deleteSuccess"), {
          duration: 6000,
          action: {
            label: t("task.toast.undo"),
            onClick: () =>
              void restoreTask(snapshot).catch((e) =>
                toast.error(t("task.toast.restoreError", { msg: String(e) })),
              ),
          },
        }),
      )
      .catch((e) => toast.error(t("task.toast.deleteError", { msg: String(e) })));
  };
  // 右键菜单：跳转来源会话（不经卡片点击事件）
  const goSource = () => {
    if (!task.source_session_id) return;
    const params = new URLSearchParams({ session: task.source_session_id });
    if (task.source_provider) params.set("provider", task.source_provider);
    navigate(`/sessions?${params.toString()}`);
  };

  // 来源区分：CLI 同步来的任务不可注入 CLI（避免循环）；自建任务可加入「注入集」。
  const cliSynced = isCliSynced(task);
  const [inInjectSet, setInInjectSet] = useState(() =>
    getInjectSet(task.project).has(task.id),
  );
  const toggleInjectSet = () => {
    setInInjectSet(toggleInject(task.project, task.id));
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: "task", stateId: task.state },
    // 多选模式下禁用拖拽，避免多选点击与拖拽冲突
    disabled: selectMode,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  // 卡片点击：多选模式下切换勾选；普通模式下打开编辑
  function handleCardClick(e: React.MouseEvent) {
    if (selectMode) {
      e.stopPropagation();
      onToggleSelect?.(task.id);
    } else {
      onEdit?.(task);
    }
  }

  // 点击"来源会话"徽章：跳转到会话中枢，携带会话 id 作为定位信号。
  function handleSourceClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!task.source_session_id) return;
    const params = new URLSearchParams({ session: task.source_session_id });
    if (task.source_provider) params.set("provider", task.source_provider);
    navigate(`/sessions?${params.toString()}`);
  }

  const taskLabels = useMemo(
    () => labels.filter((l) => task.labels?.includes(l.id)),
    [labels, task.labels],
  );
  const priority = PRIORITY_META[task.priority];
  const overdue = task.due_date ? isOverdue(task.due_date) : false;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleCardClick}
      className={cn(
        "group/card relative cursor-pointer rounded-xl border border-border bg-card p-3 transition-all hover:border-foreground/20",
        isDragging && "opacity-50 shadow-lg ring-2 ring-primary/20",
        // 多选模式选中态：蓝色描边高亮
        selectMode && selected && "border-primary/60 ring-1 ring-primary/30 bg-primary/5",
        // 已归档：降饱和虚线框，与活跃任务区分
        task.archived && "border-dashed opacity-60",
      )}
    >
      {/* 已归档角标 */}
      {task.archived && (
        <span className="absolute right-2 top-2 z-10 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {t("task.archived")}
        </span>
      )}
      {/* 多选模式：左上角勾选图标 */}
      {selectMode && (
        <div className="absolute left-2 top-2 z-10">
          <HugeiconsIcon
            icon={selected ? CheckmarkCircle02Icon : CircleIcon}
            strokeWidth={2}
            className={cn(
              "size-4 transition-colors",
              selected ? "text-primary" : "text-muted-foreground",
            )}
          />
        </div>
      )}

      {/* 标签 chips（颜色来自用户数据，inline style；多选模式缩进避开勾选框） */}
      {taskLabels.length > 0 && (
        <div className={cn("mb-2 flex flex-wrap gap-1", selectMode && "pl-6")}>
          {taskLabels.map((label) => (
            <span
              key={label.id}
              className="inline-flex h-4.5 items-center rounded-md px-1.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: label.color }}
            >
              {label.name}
            </span>
          ))}
        </div>
      )}

      {/* 标题（多选模式且无标签时缩进，避开勾选框） */}
      <p className={cn(
        "text-sm font-medium leading-snug text-foreground",
        selectMode && taskLabels.length === 0 && "pl-6",
      )}>
        {task.title}
      </p>

      {/* 描述指示 */}
      {task.description && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <HugeiconsIcon
            icon={TextAlignLeftIcon}
            strokeWidth={2}
            className="size-3 shrink-0"
          />
          {/* 预览：剥掉 markdown 语法噪声后单行截断（描述可能是 markdown 数据） */}
          <span className="truncate">{stripMarkdown(task.description)}</span>
        </div>
      )}

      {/* 页脚：优先级 + 截止日期 + 来源会话 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {/* 优先级徽章（none 不显示） */}
        {task.priority !== "none" && (
          <Badge
            variant="secondary"
            className={cn("h-4.5 gap-1 px-1.5 text-[10px]", priority.badge)}
          >
            <span className={cn("size-1.5 rounded-full", priority.dot)} />
            {t(`meta.priority.${task.priority}`)}
          </Badge>
        )}

        {/* 截止日期 */}
        {task.due_date && (
          <span
            className={cn(
              "flex items-center gap-0.5 text-[10px]",
              overdue ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            <HugeiconsIcon
              icon={Calendar03Icon}
              strokeWidth={2}
              className="size-3"
            />
            {formatDate(task.due_date, i18n.language)}
          </span>
        )}

        {/* 已入队徽标（指派后、worker 领取前的过渡态；不可点） */}
        {showEnqueued && (
          <span
            className={cn(
              "flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
              ENQUEUED_BADGE.cls,
            )}
            title={t("agent.enqueuedTitle")}
          >
            {t("agent.enqueued")}
          </span>
        )}

        {/* 运行状态徽标（running/review/blocked 时显示；点击打开 AgentRunPanel）*/}
        {runBadge && latestRun && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // 优先调用外部回调（向后兼容），否则自行打开面板
              if (onRunClick) {
                onRunClick(latestRun);
              } else {
                setRunPanelOpen(true);
              }
            }}
            className={cn(
              "flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 cursor-pointer hover:opacity-80",
              runBadge.cls,
            )}
          >
            {runBadge.label}
          </button>
        )}

        {/* 来源会话徽章（点击跳转会话中枢）。CLI 同步来的额外标「↻会话」以区分自建任务。 */}
        {task.source_session_id && (
          <button
            type="button"
            onClick={handleSourceClick}
            aria-label={t("task.sourceSessionAriaLabel")}
            title={
              cliSynced
                ? t("task.sourceSessionCliTitle", { id: task.source_session_id })
                : t("task.sourceSessionTitle", { id: task.source_session_id })
            }
            className={cn(
              "ml-auto flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              cliSynced
                ? "bg-primary/10 text-primary hover:bg-primary/20"
                : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary",
            )}
          >
            <HugeiconsIcon icon={Message01Icon} strokeWidth={2} className="size-3" />
            {cliSynced ? t("task.sourceSessionCli") : t("task.sourceSession")}
          </button>
        )}

        {/* S2：已指派命名队友时显示队友徽标（{emoji} {name}）；否则回退 provider 文字 */}
        {assignedAgent && (
          <span
            className="ml-auto flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            title={assignedAgent.name}
          >
            {assignedAgent.emoji ? `${assignedAgent.emoji} ` : ""}{assignedAgent.name}
          </span>
        )}
        {!assignedAgent && task.agent_provider && (
          <span className="ml-auto flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {providerLabel(task.agent_provider)}
          </span>
        )}

        {/* 「指派 agent」下拉（S2：列命名队友；多选模式隐藏防误触）。
            指派 = 写 agent_id 并入队，由后台 worker 自动领取执行（Multica 式指派即派发）。*/}
        {!selectMode && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                disabled={agentRunning}
                title={t("agent.assignTitle")}
                className={cn(
                  "ml-auto flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  agentRunning
                    ? "cursor-not-allowed opacity-50 bg-muted text-muted-foreground"
                    : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary",
                )}
              >
                {agentRunning ? t("agent.running") : t("agent.assignBtn")}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuLabel>{t("agent.assignMenuLabel")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {/* 已有活动 run 或已入队时，显示提示并禁用指派项（spec §防手滑） */}
              {assignLocked && (
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground px-2 py-1">
                  {t("agent.assignLockedHint")}
                </DropdownMenuLabel>
              )}
              {/* S2：无活跃队友时引导去 Agents 页建队友 */}
              {activeAgents.length === 0 ? (
                <DropdownMenuItem onSelect={() => navigate("/agents")}>
                  {t("agent.noAgents")}
                </DropdownMenuItem>
              ) : (
                activeAgents.map((a) => (
                  <DropdownMenuItem
                    key={a.id}
                    disabled={assignLocked}
                    onSelect={() => void assignAgent(a.id, a.name)}
                  >
                    {t("agent.assignTo", { emoji: a.emoji ?? "", name: a.name })}
                  </DropdownMenuItem>
                ))
              )}
              {/* 次要动作：绕过队列立即跑一次（调试/急用）；只有有队友时才显示 */}
              {activeAgents.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  {activeAgents.map((a) => (
                    <DropdownMenuItem
                      key={`run-${a.id}`}
                      onSelect={() => void runWithAgent(a.id, a.name)}
                    >
                      {t("agent.runNowWith", { name: a.name })}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
      </ContextMenuTrigger>

      {/* Agent Run 面板：点击运行徽标打开，操作成功后刷新徽标 */}
      <AgentRunPanel
        taskId={task.id}
        open={runPanelOpen}
        onClose={() => setRunPanelOpen(false)}
        onRefresh={() => {
          listAgentRuns(taskIdRef.current)
            .then((runs) => setLatestRun(runs[0] ?? null))
            .catch(() => undefined);
        }}
      />

      {/* 右键菜单：选择（进入多选）/ 编辑 / 优先级 / 移动 / 来源会话 / 删除 */}
      <ContextMenuContent>
        {/* 「选择」：进入多选模式并将本卡片设为已选 */}
        <ContextMenuItem onSelect={() => onEnterSelect?.(task.id)}>{t("task.ctxMenu.select")}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onEdit?.(task)}>{t("task.ctxMenu.edit")}</ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("task.ctxMenu.priority")}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {PRIORITY_ORDER.map((p) => (
              <ContextMenuItem key={p} onSelect={() => setPriority(p)}>
                <span className={cn("size-1.5 rounded-full", PRIORITY_META[p].dot)} />
                {t(`meta.priority.${p}`)}
                {p === task.priority && (
                  <span className="ml-auto text-xs text-muted-foreground">{t("task.ctxMenu.current")}</span>
                )}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("task.ctxMenu.moveTo")}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {states.length === 0 ? (
              <ContextMenuLabel>{t("task.ctxMenu.noStates")}</ContextMenuLabel>
            ) : (
              states.map((st) => (
                <ContextMenuItem
                  key={st.id}
                  disabled={st.id === task.state}
                  onSelect={() => moveTo(st.id)}
                >
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: st.color }} />
                  {st.name}
                  {st.id === task.state && (
                    <span className="ml-auto text-xs text-muted-foreground">{t("task.ctxMenu.current")}</span>
                  )}
                </ContextMenuItem>
              ))
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {task.source_session_id && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={goSource}>
              {t("task.ctxMenu.gotoSource")}
            </ContextMenuItem>
          </>
        )}

        {/* 注入 CLI：仅自建任务可加入注入集（CLI 同步来的排除，避免注回自己） */}
        {!cliSynced && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={toggleInjectSet}>
              {inInjectSet ? t("task.ctxMenu.removeFromInjectSet") : t("task.ctxMenu.addToInjectSet")}
            </ContextMenuItem>
          </>
        )}

        <ContextMenuSeparator />
        {/* 归档：完成任务软删除（保留溯源），默认从看板隐藏；可取消归档 */}
        <ContextMenuItem
          onSelect={() =>
            void updateTask(task.id, { archived: !task.archived }).catch((e) =>
              toast.error(t("task.toast.archiveError", { msg: String(e) })),
            )
          }
        >
          {task.archived ? t("task.ctxMenu.unarchive") : t("task.ctxMenu.archive")}
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={remove}>
          {t("common:action.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// memo：仅当自身 props（task/选中态/回调）变化才重渲。
// 关键前提——已去掉组件内对整个 tasks 数组的订阅，否则 memo 会被 store 订阅击穿。
// 父层需传稳定回调（KanbanBoard 已 useCallback），否则 memo 失效。
export const TaskCard = memo(TaskCardInner);
