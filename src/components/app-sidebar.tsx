// 应用侧栏 —— 移植自 workavera（Apache-2.0），改用 Keelson 品牌与路由，react-router-dom。
import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  StarIcon,
  ArrowRight01Icon,
  ArrowDown01Icon,
  Add01Icon,
} from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import { toast } from "sonner";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/logo";
import { navGroups } from "@/lib/navigation";
import { useBoardStore, selectPinnedProjects } from "@/store/board";
import { useSessionsStore } from "@/store/sessions";
import { useRestoreStore } from "@/store/restore";
import { ipc } from "@/lib/tauri/ipc";
import type { Session } from "@/types/session";

/** 收藏组单行：可拖拽排序，点击 NavLink 走 /board?open=<id>（board 页据此打开项目）。
 * SidebarMenuItem 未用 forwardRef 不接受 ref，故这里直接渲染等价的 <li>（复制其
 * data-slot/data-sidebar/className）承接 dnd-kit 的 ref/style，避免 ul>div>li 语义违规。
 */
function FavoriteRow({
  id,
  name,
  repoPath,
  latestSession,
}: {
  id: string;
  name: string;
  /** 项目仓库目录（供「新终端」就地起会话；无则不显示新终端） */
  repoPath?: string;
  /** 该项目最近会话（供「继续」一键续接；无则不显示继续） */
  latestSession?: Session;
}) {
  const { t } = useTranslation("board");
  const restore = useRestoreStore((s) => s.restore);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  // 「新终端」的 provider 默认最近会话的（无则 claude）
  const provider = latestSession?.provider ?? "claude";
  const providerLabel = provider === "codex" ? "Codex" : "Claude";

  // 继续：续接最近会话（新终端窗，跳过弹窗），不导航进项目
  const handleResume = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!latestSession) return;
    await restore(latestSession, false);
    const err = useRestoreStore.getState().error;
    if (err) toast.error(t("project.toast.resumeError", { msg: err }));
  };
  // 新终端：在项目目录起一个新会话
  const handleNewTerminal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!repoPath) return;
    void ipc
      .startSession(provider, repoPath)
      .then(() =>
        toast.success(t("sessions.toast.startSuccess", { provider: providerLabel })),
      )
      .catch((err) => toast.error(t("sessions.toast.startError", { msg: String(err) })));
  };

  // 接续为主：略突出(主色)；新终端为辅(临时)：更淡
  const resumeBtnCls =
    "flex size-5 items-center justify-center rounded text-primary/80 transition-colors hover:bg-sidebar-accent hover:text-primary";
  const newBtnCls =
    "flex size-5 items-center justify-center rounded text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground";
  // 接续提示：显示会接到哪个会话(最近会话的摘要)，让你续接前看清目标
  const promptSnippet = latestSession
    ? (latestSession.last_prompt || latestSession.first_prompt || "").trim().slice(0, 40)
    : "";
  const resumeTitle = promptSnippet
    ? t("project.resumeActionTitle", { provider, text: promptSnippet })
    : t("project.continueTitle", { provider });

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className="group/menu-item relative"
    >
      <SidebarMenuButton asChild tooltip={name}>
        <NavLink to={`/board?open=${id}`} {...attributes} {...listeners}>
          <HugeiconsIcon icon={StarIcon} strokeWidth={2} />
          <span className="truncate">{name}</span>
        </NavLink>
      </SidebarMenuButton>
      {/* 悬停动作：继续(续接最近会话) + 新终端(项目目录起会话)；图标折叠侧栏时隐藏 */}
      {(latestSession || repoPath) && (
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/menu-item:opacity-100 group-data-[collapsible=icon]:hidden">
          {latestSession && (
            <button
              type="button"
              className={resumeBtnCls}
              onClick={handleResume}
              title={resumeTitle}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />
            </button>
          )}
          {repoPath && (
            <button
              type="button"
              className={newBtnCls}
              onClick={handleNewTerminal}
              title={t("project.newTempTitle", { provider: providerLabel })}
            >
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function AppSidebar() {
  const { t } = useTranslation("shell");
  const { pathname } = useLocation();

  // 收藏项目：从 board store 读 projects，派生出已收藏列表
  const projects = useBoardStore((s) => s.projects);
  const reorderPin = useBoardStore((s) => s.reorderPin);
  const pinned = useMemo(() => selectPinnedProjects(projects), [projects]);

  // 会话缓存：供收藏行「继续」定位每个项目的最近会话
  const sessions = useSessionsStore((s) => s.sessions);
  const latestSessionOf = (repoPath?: string): Session | undefined => {
    if (!repoPath) return undefined;
    const list = sessions.filter((s) => s.project_path === repoPath);
    return list.length ? list.reduce((a, b) => (a.updated_at > b.updated_at ? a : b)) : undefined;
  };

  // 「更多」组折叠态（默认收起，记住选择）——降级的功能收进这里，日常不占前排
  const [moreOpen, setMoreOpen] = useState<boolean>(
    () => localStorage.getItem("keelson-nav-more-open") === "1",
  );
  const toggleMore = () =>
    setMoreOpen((o) => {
      const next = !o;
      localStorage.setItem("keelson-nav-more-open", next ? "1" : "0");
      return next;
    });

  // 兜底：侧栏在任意页都可见，若项目尚未加载（用户没进过「项目」页）则拉一次，
  // 使收藏组启动即可用。loadProjects 仅做列表拉取（无实时订阅副作用），重复调用安全。
  useEffect(() => {
    const s = useBoardStore.getState();
    // 加载中不重复触发（避免与「项目」页首次加载并发拉两次）
    if (!s.projects.length && !s.loading) {
      void s.loadProjects();
    }
  }, []);

  // dnd-kit：6px 距离阈值防误触
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // 拖拽结束：计算目标位置后调 store reorderPin（乐观写 pin_rank）
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    // to = over 在收藏列表里的目标下标；reorderPin 内部会排除自己后在该下标处插入，
    // 与 dnd-kit arrayMove(full, from, to) 语义一致（下拖/上拖均正确）。
    const to = pinned.findIndex((p) => p.id === over.id);
    if (to < 0) return;
    void reorderPin(String(active.id), to).catch(() => {
      /* 失败回滚已在 store 内，拖拽不弹 toast 以免打断 */
    });
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              className="data-[slot=sidebar-menu-button]:!p-2"
            >
              <NavLink to="/dashboard">
                {/* 品牌标记（裸 SVG，对齐 workavera 样式） */}
                <Logo className="!size-[30px] shrink-0 group-data-[collapsible=icon]:!size-4" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Keelson</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t("sidebar.tagline")}
                  </span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* 收藏组：置顶，空收藏不渲染；dnd-kit 拖拽排序，点击走 ?open 深链 */}
        {pinned.length > 0 && (
          <SidebarGroup>
            {/* 分组标题滚动时钉顶：栏目多/收藏多时不丢失分组上下文 */}
            <SidebarGroupLabel className="sticky top-0 z-10 bg-sidebar">
              {t("sidebar.favorites")}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={pinned.map((p) => p.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {pinned.map((p) => (
                      <FavoriteRow
                        key={p.id}
                        id={p.id}
                        name={p.name}
                        repoPath={p.repo_path}
                        latestSession={latestSessionOf(p.repo_path)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {navGroups.map((group) => {
          // 「更多」组可折叠（默认收起）；其余组照常展开
          const isMore = group.labelKey === "nav.groupMore";
          const showItems = !isMore || moreOpen;
          return (
            <SidebarGroup key={group.labelKey}>
              {isMore ? (
                <SidebarGroupLabel asChild className="sticky top-0 z-10 bg-sidebar">
                  <button
                    type="button"
                    onClick={toggleMore}
                    aria-expanded={moreOpen}
                    className="flex w-full items-center gap-1"
                  >
                    <HugeiconsIcon
                      icon={moreOpen ? ArrowDown01Icon : ArrowRight01Icon}
                      strokeWidth={2}
                      className="size-3.5 shrink-0"
                    />
                    {t(group.labelKey)}
                  </button>
                </SidebarGroupLabel>
              ) : (
                <SidebarGroupLabel className="sticky top-0 z-10 bg-sidebar">
                  {t(group.labelKey)}
                </SidebarGroupLabel>
              )}
              {showItems && (
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <SidebarMenuItem key={item.titleKey}>
                        <SidebarMenuButton
                          asChild
                          tooltip={t(item.titleKey)}
                          isActive={
                            pathname === item.url ||
                            pathname.startsWith(item.url + "/")
                          }
                        >
                          <NavLink to={item.url}>
                            <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                            <span>{t(item.titleKey)}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              )}
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <div className="px-3 py-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          <p className="font-medium text-foreground/70">Keelson</p>
          <p className="mt-0.5">{t("sidebar.hint")}</p>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
