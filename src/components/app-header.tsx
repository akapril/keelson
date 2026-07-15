// 应用头部 —— 移植自 workavera（Apache-2.0）的头部外壳，剥离通知/聊天/用户菜单耦合。
// 保留：折叠触发器 + 面包屑 + 主题切换。用户菜单待 Phase⑤ 多用户再补。
import { useLocation } from "react-router-dom";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { flatNavItems } from "@/lib/navigation";

export function AppHeader() {
  const location = useLocation();
  // 当前路由对应的导航标题（用于面包屑）
  const currentNav = flatNavItems.find(
    (item) => location.pathname === item.url,
  );

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
        <ThemeToggle />
      </div>
    </header>
  );
}
