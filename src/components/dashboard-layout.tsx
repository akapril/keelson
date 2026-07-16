// 应用主布局 —— 移植自 workavera（Apache-2.0），去掉 ChatRunMonitor 与 full-bleed 分支。
// rework 各页面自管内边距与滚动，故 main 只提供全高容器。
import { Outlet } from "react-router-dom";

import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { CommandPalette } from "@/components/command-palette";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export function DashboardLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        {/* 全高容器：自然高度的页面（如设置）在此滚动；
            自管高度的页面（会话/看板用 h-full + 内部滚动）正好铺满。 */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <Outlet />
        </main>
      </SidebarInset>
      {/* 全局命令面板（⌘K / Ctrl+K） */}
      <CommandPalette />
    </SidebarProvider>
  );
}
