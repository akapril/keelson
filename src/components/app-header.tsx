// 应用头部 —— 移植自 workavera（Apache-2.0）的头部外壳，剥离通知/聊天/用户菜单耦合。
// 保留：折叠触发器 + 面包屑 + 主题切换。用户菜单待 Phase⑤ 多用户再补。
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Logout02Icon,
  SearchIcon,
  Download04Icon,
  Analytics01Icon,
} from "@hugeicons/core-free-icons";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
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

export function AppHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  // 更新可用状态（红标提示）
  const updateAvailable = useUpdaterStore((s) => s.available);
  const updateVersion = useUpdaterStore((s) => s.version);
  const installing = useUpdaterStore((s) => s.installing);

  // 一键下载安装并重启（成功后应用会重启，故失败才会走到 toast.error）
  const handleUpdate = async () => {
    toast.loading("正在下载并安装更新…", { id: "app-update" });
    await useUpdaterStore.getState().installAndRestart();
    toast.error(
      `更新失败：${useUpdaterStore.getState().error ?? "未知错误"}`,
      { id: "app-update" },
    );
  };
  // 当前路由对应的导航标题（用于面包屑）
  const currentNav = flatNavItems.find(
    (item) => location.pathname === item.url,
  );
  const initials = (user?.name?.charAt(0) ?? "U").toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-1 h-4 data-vertical:self-center"
      />

      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>{currentNav?.title ?? "rework"}</BreadcrumbPage>
          </BreadcrumbItem>
          {currentNav?.description && (
            <>
              <BreadcrumbSeparator className="hidden sm:block" />
              <BreadcrumbItem className="hidden text-muted-foreground sm:block">
                {currentNav.description}
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-1">
        {/* 更新可用：红标提示 + 一键更新（未发现更新时不渲染） */}
        {updateAvailable && (
          <Button
            variant="ghost"
            size="sm"
            disabled={installing}
            onClick={() => void handleUpdate()}
            title={`发现新版本 v${updateVersion}，点击下载安装并重启`}
            className="relative gap-1.5 text-primary"
          >
            <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-red-500" />
            <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
            <span className="hidden sm:inline">
              {installing ? "更新中…" : "更新"}
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
          title="成本控制塔（Token 用量 · 成本预估）"
        >
          <HugeiconsIcon icon={Analytics01Icon} strokeWidth={2} />
          <span className="hidden sm:inline">成本</span>
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
          <span className="hidden sm:inline">搜索</span>
          <kbd className="hidden rounded border border-border bg-muted px-1 text-[10px] sm:inline">
            ⌘K
          </kbd>
        </Button>
        <ActivityIndicator />
        <NotificationBell />
        <ThemeToggle />
        <Separator
          orientation="vertical"
          className="mx-1 h-4 data-vertical:self-center"
        />
        {/* 用户菜单：当前用户 + 登出（多用户） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 gap-2 px-1.5">
              <Avatar size="sm">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
                {user?.name ?? "用户"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="grid">
                <span className="truncate text-sm font-medium text-foreground">
                  {user?.name ?? "本地用户"}
                </span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {user?.email || "未设置邮箱"}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => logout()}>
              <HugeiconsIcon icon={Logout02Icon} strokeWidth={2} />
              <span>登出 / 切换用户</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
