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
  useDroppable,
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
  Cancel01Icon,
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
import { navGroups, type NavItem } from "@/lib/navigation";
import { useBoardStore, selectPinnedProjects } from "@/store/board";
import { useSessionsStore } from "@/store/sessions";
import { useRestoreStore } from "@/store/restore";
import { FavoriteRowMenu } from "@/components/favorite-row-menu";
import { recentSessionsOf } from "@/lib/recent-sessions";
import type { Session } from "@/types/session";

/** 收藏组单行：可拖拽排序，点击 NavLink 走 /board?open=<id>（board 页据此打开项目）。
 * SidebarMenuItem 未用 forwardRef 不接受 ref，故这里直接渲染等价的 <li>（复制其
 * data-slot/data-sidebar/className）承接 dnd-kit 的 ref/style，避免 ul>div>li 语义违规。
 */
function FavoriteRow({
  id,
  name,
  repoPath,
  recentSessions,
  activeId,
}: {
  id: string;
  name: string;
  /** 项目仓库目录（供菜单「新终端 / 打开目录」；无则隐藏对应项） */
  repoPath?: string;
  /** 该项目最近若干会话：[0] 供行上「接续最近」一键，全部供 ⋯ 菜单逐条接续 */
  recentSessions: Session[];
  /** 当前打开的项目 id（父组件读 board store 传入）：== id 时本行高亮 */
  activeId?: string;
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
  const latestSession = recentSessions[0];
  const provider = latestSession?.provider ?? "claude";

  // 继续：续接最近会话（新终端窗，跳过弹窗），不导航进项目
  const handleResume = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!latestSession) return;
    await restore(latestSession, false);
    const err = useRestoreStore.getState().error;
    if (err) toast.error(t("project.toast.resumeError", { msg: err }));
  };

  // 接续为主：略突出(主色)；⋯ 菜单为辅：更淡
  const resumeBtnCls =
    "flex size-5 items-center justify-center rounded text-primary/80 transition-colors hover:bg-sidebar-accent hover:text-primary";
  const moreBtnCls =
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
      <SidebarMenuButton asChild tooltip={name} isActive={activeId === id}>
        {/* from=fav：标记"侧栏收藏浏览进入"，ProjectWorkspace 返回时据此回项目列表而非后退 */}
        <NavLink to={`/board?open=${id}&from=fav`} {...attributes} {...listeners}>
          <HugeiconsIcon icon={StarIcon} strokeWidth={2} />
          <span className="truncate">{name}</span>
        </NavLink>
      </SidebarMenuButton>
      {/* 悬停动作：接续最近(一键) + ⋯(展开会话列表/新终端/更多)；菜单打开时保持可见；折叠侧栏时隐藏 */}
      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/menu-item:opacity-100 has-[[data-state=open]]:opacity-100 group-data-[collapsible=icon]:hidden">
        {latestSession && (
          <button type="button" className={resumeBtnCls} onClick={handleResume} title={resumeTitle}>
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />
          </button>
        )}
        <FavoriteRowMenu
          projectId={id}
          projectName={name}
          repoPath={repoPath}
          recentSessions={recentSessions}
          triggerClassName={moreBtnCls}
        />
      </div>
    </li>
  );
}

// 「更多」组的 i18n label 键（其页面可被拖进「常用」组）
const MORE_GROUP_KEY = "nav.groupKnowledge";
// 「常用」组的放置区 droppable id（拖到空组/组容器时用）
const CUSTOM_DROP_ID = "nav-custom-drop";
// 自定义「常用」栏持久化键（存被置顶页面的 url 列表，含顺序）
const NAV_CUSTOM_LS = "keelson-nav-custom";

/** 可拖拽的导航行：用于「常用」组与「更多」组。
 * 拖进「常用」=置顶、组内拖=排序；在「常用」里 hover 出「×」可移除（比拖回更好发现）。
 * NavLink 同时承接拖拽 listeners：PointerSensor distance:6 → 小于阈值即点击导航，超过即拖拽。
 */
function DraggableNavRow({
  item,
  active,
  onUnpin,
}: {
  item: NavItem;
  /** 是否为当前路由（高亮） */
  active: boolean;
  /** 传入则渲染「×」移除按钮（仅「常用」组行传入） */
  onUnpin?: () => void;
}) {
  const { t } = useTranslation("shell");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.url });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className="group/nav-item relative"
    >
      <SidebarMenuButton asChild tooltip={t(item.titleKey)} isActive={active}>
        <NavLink
          to={item.url}
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing"
        >
          <HugeiconsIcon icon={item.icon} strokeWidth={2} />
          <span>{t(item.titleKey)}</span>
        </NavLink>
      </SidebarMenuButton>
      {onUnpin && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onUnpin();
          }}
          title={t("nav.unpinCustom")}
          className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-sidebar-foreground/45 opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover/nav-item:opacity-100 group-data-[collapsible=icon]:hidden"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
        </button>
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
  // 当前打开的项目 id：供收藏行精确高亮（仅当前打开的收藏项亮，避免所有收藏行都因 pathname=/board 命中）
  const openedProjectId = useBoardStore((s) => s.openedProjectId);

  // 会话缓存：供收藏行「接续最近」与 ⋯ 菜单「继续会话」定位每个项目的最近会话
  const sessions = useSessionsStore((s) => s.sessions);

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

  // 「收藏」组折叠态（默认展开，记住选择）——固定项目常用，故与「更多」相反默认展开：
  // 仅当显式存过 "0" 才收起，未设/其它值均视为展开。
  const [favOpen, setFavOpen] = useState<boolean>(
    () => localStorage.getItem("keelson-nav-fav-open") !== "0",
  );
  const toggleFav = () =>
    setFavOpen((o) => {
      const next = !o;
      localStorage.setItem("keelson-nav-fav-open", next ? "1" : "0");
      return next;
    });

  // ── 自定义「常用」栏：把「更多」组里的页面拖出来置顶（url 列表持久化 localStorage） ──
  const [customUrls, setCustomUrls] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(NAV_CUSTOM_LS);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const persistCustom = (next: string[]) => {
    setCustomUrls(next);
    localStorage.setItem(NAV_CUSTOM_LS, JSON.stringify(next));
  };
  // 拖拽进行中：用于「常用」组为空时临时浮现放置区（平时不占位）
  const [navDragging, setNavDragging] = useState(false);

  // 「更多」组及其页面（唯一可被置顶的来源）
  const moreGroup = useMemo(
    () => navGroups.find((g) => g.labelKey === MORE_GROUP_KEY),
    [],
  );
  const moreItems = moreGroup?.items ?? [];
  const moreUrlSet = useMemo(() => new Set(moreItems.map((i) => i.url)), [moreItems]);
  // 已置顶页面（按 customUrls 顺序，过滤掉失效 url）
  const customItems = useMemo(
    () =>
      customUrls
        .map((url) => moreItems.find((i) => i.url === url))
        .filter((i): i is NavItem => Boolean(i)),
    [customUrls, moreItems],
  );
  // 「更多」组里剩余（未置顶）的页面
  const moreRemaining = useMemo(
    () => moreItems.filter((i) => !customUrls.includes(i.url)),
    [moreItems, customUrls],
  );

  // 「常用」组放置区（拖到空组/组容器时用 over.id === CUSTOM_DROP_ID 命中）
  const { setNodeRef: setCustomDropRef } = useDroppable({ id: CUSTOM_DROP_ID });

  // 导航拖拽结束：仅当落到「常用」组才处理（置顶/排序）；移除走行内「×」
  const handleNavDragEnd = (e: DragEndEvent) => {
    setNavDragging(false);
    const { active, over } = e;
    if (!over) return;
    const activeUrl = String(active.id);
    if (!moreUrlSet.has(activeUrl)) return; // 只接受「更多」组来源
    const overId = String(over.id);
    const customSet = new Set(customUrls);
    const targetIsCustom = overId === CUSTOM_DROP_ID || customSet.has(overId);
    if (!targetIsCustom) return; // 没落到「常用」组 → 不动（移除请用行内 ×）
    // 先摘出自己，再按落点插入：落在某常用项上=插到它前面，落在空组/容器上=追加到末尾
    const base = customUrls.filter((u) => u !== activeUrl);
    let idx = base.length;
    if (overId !== CUSTOM_DROP_ID) {
      const i = base.indexOf(overId);
      if (i >= 0) idx = i;
    }
    persistCustom([...base.slice(0, idx), activeUrl, ...base.slice(idx)]);
  };

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
        {/* 收藏组：置顶，空收藏不渲染；标题可折叠（默认展开）；dnd-kit 拖拽排序，点击走 ?open 深链 */}
        {pinned.length > 0 && (
          <SidebarGroup>
            {/* 分组标题滚动时钉顶 + 可点折叠：点标题收起/展开固定项目，chevron 指示状态 */}
            <SidebarGroupLabel asChild className="sticky top-0 z-10 bg-sidebar">
              <button
                type="button"
                onClick={toggleFav}
                aria-expanded={favOpen}
                className="flex w-full items-center gap-1"
              >
                <HugeiconsIcon
                  icon={favOpen ? ArrowDown01Icon : ArrowRight01Icon}
                  strokeWidth={2}
                  className="size-3.5 shrink-0"
                />
                {t("sidebar.favorites")}
              </button>
            </SidebarGroupLabel>
            {favOpen && (
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
                          recentSessions={recentSessionsOf(sessions, p.repo_path, 5)}
                          activeId={openedProjectId ?? undefined}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}
        {/* 常用 + 导航组：包一层 DndContext，支持把「更多」页面拖进「常用」组置顶 */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={() => setNavDragging(true)}
          onDragEnd={handleNavDragEnd}
          onDragCancel={() => setNavDragging(false)}
        >
          {/* 「常用」组：有置顶项 or 拖拽进行中才渲染（平时不占位）；组内可拖排序、hover 出「×」移除 */}
          {(customItems.length > 0 || navDragging) && (
            <SidebarGroup>
              <SidebarGroupLabel className="sticky top-0 z-10 bg-sidebar">
                {t("nav.groupCustom")}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                {/* droppable 容器：拖到空组/间隙时 over.id === CUSTOM_DROP_ID 命中 */}
                <div ref={setCustomDropRef}>
                  <SidebarMenu>
                    <SortableContext
                      items={customItems.map((i) => i.url)}
                      strategy={verticalListSortingStrategy}
                    >
                      {customItems.map((item) => (
                        <DraggableNavRow
                          key={item.url}
                          item={item}
                          active={
                            pathname === item.url || pathname.startsWith(item.url + "/")
                          }
                          onUnpin={() =>
                            persistCustom(customUrls.filter((u) => u !== item.url))
                          }
                        />
                      ))}
                    </SortableContext>
                    {/* 空组（仅拖拽时浮现）：给个虚线放置区 + 引导文案，让「拖出来」可发现 */}
                    {customItems.length === 0 && (
                      <li className="mx-2 my-1 rounded-md border border-dashed border-sidebar-border px-2 py-3 text-center text-xs text-sidebar-foreground/50">
                        {t("nav.customDropHint")}
                      </li>
                    )}
                  </SidebarMenu>
                </div>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
          {navGroups.map((group) => {
            // 「知识 · 更多」组可折叠（默认收起）+ 其页面可拖进「常用」；其余组照常展开
            const isMore = group.labelKey === "nav.groupKnowledge";
            const showItems = !isMore || moreOpen;
            // 更多组只渲染未置顶项（已置顶的移到「常用」组）
            const items = isMore ? moreRemaining : group.items;
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
                      {isMore ? (
                        // 更多组：可拖拽行（拖进「常用」置顶）
                        <SortableContext
                          items={items.map((i) => i.url)}
                          strategy={verticalListSortingStrategy}
                        >
                          {items.map((item) => (
                            <DraggableNavRow
                              key={item.url}
                              item={item}
                              active={
                                pathname === item.url ||
                                pathname.startsWith(item.url + "/")
                              }
                            />
                          ))}
                        </SortableContext>
                      ) : (
                        // 其余组：静态导航项（不参与拖拽）
                        items.map((item) => (
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
                        ))
                      )}
                    </SidebarMenu>
                  </SidebarGroupContent>
                )}
              </SidebarGroup>
            );
          })}
        </DndContext>
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
