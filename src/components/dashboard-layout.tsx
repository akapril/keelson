// 应用主布局 —— 移植自 workavera（Apache-2.0），去掉 ChatRunMonitor 与 full-bleed 分支。
// rework 各页面自管内边距与滚动，故 main 只提供全高容器。
import { Suspense, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { CommandPalette } from "@/components/command-palette";
import { ShortcutsOverlay } from "@/components/shortcuts-overlay";
import { GotoNav } from "@/components/goto-nav";
import { ErrorBoundary } from "@/components/error-boundary";
import { UpdateDialog } from "@/components/update-dialog";
import { ExitConfirmDialog } from "@/components/exit-confirm-dialog";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { on } from "@/lib/tauri/events";
import { useActivityStore } from "@/store/activity";
import { maybeAutoSyncTasks } from "@/features/board/auto-sync-tasks";
import type { ActivityEvent } from "@/types/activity";

export function DashboardLayout() {
  const { t } = useTranslation(["shell", "common"]);
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
  // 性能：Claude 爆发式调工具时事件高频到达，逐条 push 会造成渲染风暴（每条一次数组拷贝+
  // 全量排序+整列表重渲）。故在此按 120ms 窗口合批，一批只触发一次重渲。
  useEffect(() => {
    let buffer: ActivityEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      useActivityStore.getState().pushMany(batch);
    };
    const p = on<ActivityEvent>("activity", (ev) => {
      if (!ev) return;
      buffer.push(ev);
      if (!timer) timer = setTimeout(flush, 120);
      // Task 工具事件 → 自动把该会话规划任务同步进匹配看板项目（自身已防抖）
      maybeAutoSyncTasks(ev);
    });
    return () => {
      if (timer) clearTimeout(timer);
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
                  {t("common:state.loading")}
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
      {/* 全局快捷键速查表（? 唤起） */}
      <ShortcutsOverlay />
      {/* g 前缀直达导航（g + 页面键） */}
      <GotoNav />
      {/* 升级弹窗（发现新版本自动弹） */}
      <UpdateDialog />
      {/* 退出确认弹窗（退出行为=每次询问 且有运行进程时弹） */}
      <ExitConfirmDialog />
    </SidebarProvider>
  );
}
