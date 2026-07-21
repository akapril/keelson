// 应用主布局 —— 移植自 workavera（Apache-2.0），去掉 ChatRunMonitor 与 full-bleed 分支。
// rework 各页面自管内边距与滚动，故 main 只提供全高容器。
import { Suspense, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { CommandPalette } from "@/components/command-palette";
import { ErrorBoundary } from "@/components/error-boundary";
import { UpdateDialog } from "@/components/update-dialog";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { on } from "@/lib/tauri/events";
import { useActivityStore } from "@/store/activity";
import type { ActivityEvent } from "@/types/activity";

export function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  // 监听 Spotlight 发来的导航事件（打开任务/文档）：在主窗内跳转到深链。
  useEffect(() => {
    const p = on<string>("spotlight-navigate", (path) => {
      if (path) navigate(path);
    });
    return () => {
      void p.then((un) => un());
    };
  }, [navigate]);

  // 监听后端活动流事件（MCP 工具调用）：推入内存环形缓冲，供顶栏指示 + 项目 tab 实时渲染。
  // 挂在 DashboardLayout（仅主窗渲染、生命周期与主界面一致），全应用仅订阅一次。
  useEffect(() => {
    const p = on<ActivityEvent>("activity", (ev) => {
      if (ev) useActivityStore.getState().push(ev);
    });
    return () => {
      void p.then((un) => un());
    };
  }, []);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        {/* 全高容器：自然高度的页面（如设置）在此滚动；
            自管高度的页面（会话/看板用 h-full + 内部滚动）正好铺满。 */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {/* 错误边界（单页崩不白屏）+ Suspense（路由懒加载兜底） */}
          <ErrorBoundary fallbackKey={location.pathname}>
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  加载中…
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </SidebarInset>
      {/* 全局命令面板（⌘K / Ctrl+K） */}
      <CommandPalette />
      {/* 升级弹窗（发现新版本自动弹） */}
      <UpdateDialog />
    </SidebarProvider>
  );
}
