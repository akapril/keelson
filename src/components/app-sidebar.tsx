// 应用侧栏 —— 移植自 workavera（Apache-2.0），改用 Keelson 品牌与路由，react-router-dom。
import { useEffect, useMemo } from "react";
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
import { StarIcon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

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

/** 收藏组单行：可拖拽排序，点击 NavLink 走 /board?open=<id>（board 页据此打开项目）。
 * SidebarMenuItem 未用 forwardRef 不接受 ref，故这里直接渲染等价的 <li>（复制其
 * data-slot/data-sidebar/className）承接 dnd-kit 的 ref/style，避免 ul>div>li 语义违规。
 */
function FavoriteRow({ id, name }: { id: string; name: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
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
      className="group/menu-item relative"
    >
      <SidebarMenuButton asChild tooltip={name}>
        <NavLink to={`/board?open=${id}`} {...attributes} {...listeners}>
          <HugeiconsIcon icon={StarIcon} strokeWidth={2} />
          <span className="truncate">{name}</span>
        </NavLink>
      </SidebarMenuButton>
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
            <SidebarGroupLabel>{t("sidebar.favorites")}</SidebarGroupLabel>
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
                      <FavoriteRow key={p.id} id={p.id} name={p.name} />
                    ))}
                  </SortableContext>
                </DndContext>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {navGroups.map((group) => (
          <SidebarGroup key={group.labelKey}>
            <SidebarGroupLabel>{t(group.labelKey)}</SidebarGroupLabel>
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
          </SidebarGroup>
        ))}
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
