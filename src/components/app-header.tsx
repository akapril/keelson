// 应用头部 —— 移植自 workavera（Apache-2.0）的头部外壳，剥离通知/聊天/用户菜单耦合。
// 保留：折叠触发器 + 面包屑 + 主题切换。用户菜单待 Phase⑤ 多用户再补。
import { useLocation, useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Logout02Icon,
  SearchIcon,
  Download04Icon,
  Analytics01Icon,
} from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notification-bell";
import { ActivityIndicator } from "@/components/activity-indicator";
import { flatNavItems } from "@/lib/navigation";
import { useAuthStore } from "@/store/auth";
import { useUpdaterStore } from "@/store/updater";
import { getRemotePbUrl } from "@/lib/pb";

export function AppHeader() {
  const { t } = useTranslation("shell");
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  // 更新可用状态（红标提示）
  const updateAvailable = useUpdaterStore((s) => s.available);
  const updateVersion = useUpdaterStore((s) => s.version);
  const installing = useUpdaterStore((s) => s.installing);
  const openUpdateDialog = useUpdaterStore((s) => s.openDialog);
  // 当前路由对应的导航标题（用于面包屑）
  const currentNav = flatNavItems.find(
    (item) => location.pathname === item.url,
  );
  // 不在侧栏导航里的页面标题（成本塔入口在头部、收件箱经通知铃进入）
  const EXTRA_TITLES: Record<string, string> = {
    "/usage": t("header.usageTitle"),
    "/inbox": t("header.inboxTitle"),
  };
  const currentTitle = currentNav
    ? t(currentNav.titleKey)
    : EXTRA_TITLES[location.pathname] ?? "Keelson";
  const initials = (user?.name?.charAt(0) ?? "U").toUpperCase();
  // 仅远程模式（设置了远程 PB URL）才显示用户菜单/登出：远程是真实账号登录，登出有意义。
  // 本地免登录模式下登出=把自己锁在无凭据的登录界面（负资产），故整块隐藏。
  const isRemote = !!getRemotePbUrl();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-1 h-4 data-vertical:self-center"
      />

      {/* 扁平导航无层级，面包屑仅作当前页标题（不假装可导航；描述已去除避免头部啰嗦） */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>{currentTitle}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-1">
        {/* 更新可用：红标提示 + 一键更新（未发现更新时不渲染） */}
        {updateAvailable && (
          <Button
            variant="ghost"
            size="sm"
            onClick={openUpdateDialog}
            title={t("header.updateTooltip", { version: updateVersion })}
            className="relative gap-1.5 text-primary"
          >
            <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-red-500" />
            <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
            <span className="hidden sm:inline">
              {installing ? t("header.updateInstalling") : t("header.updateLabel")}
            </span>
          </Button>
        )}

        {/* 成本控制塔入口（放在搜索左侧） */}
        <Button
          variant="ghost"
          size="sm"
          className={
            location.pathname === "/usage"
              ? "gap-1.5 text-primary"
              : "gap-1.5 text-muted-foreground"
          }
          onClick={() => navigate("/usage")}
          title={t("header.costTooltip")}
        >
          <HugeiconsIcon icon={Analytics01Icon} strokeWidth={2} />
          <span className="hidden sm:inline">{t("header.costLabel")}</span>
        </Button>

        {/* 全局搜索（打开命令面板 ⌘K） */}
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("open-command-palette"))
          }
        >
          <HugeiconsIcon icon={SearchIcon} strokeWidth={2} />
          <span className="hidden sm:inline">{t("header.searchLabel")}</span>
          <kbd className="hidden rounded border border-border bg-muted px-1 text-[10px] sm:inline">
            ⌘K
          </kbd>
        </Button>
        <ActivityIndicator />
        <NotificationBell />
        <ThemeToggle />
        {/* 用户菜单：仅远程模式显示（含登出）；本地免登录模式整块隐藏，避免登出锁死 */}
        {isRemote && (
          <>
            <Separator
              orientation="vertical"
              className="mx-1 h-4 data-vertical:self-center"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 gap-2 px-1.5">
                  <Avatar size="sm">
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
                    {user?.name ?? t("header.userFallback")}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="grid">
                    <span className="truncate text-sm font-medium text-foreground">
                      {user?.name ?? t("header.localUser")}
                    </span>
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      {user?.email || t("header.noEmail")}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => logout()}>
                  <HugeiconsIcon icon={Logout02Icon} strokeWidth={2} />
                  <span>{t("header.logout")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </header>
  );
}
