import { useEffect } from "react";
import { ThemeProvider } from "./components/theme-provider";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";
import { useAuthStore } from "./store/auth";
import { AppRouter } from "./router";
import { thisWindowLabel } from "./lib/tauri/window";
import { SpotlightApp } from "./features/spotlight/SpotlightApp";
import { LoginScreen } from "./features/auth/LoginScreen";

export default function App() {
  const { ready, authed, error, init } = useAuthStore();

  useEffect(() => {
    init();
  }, [init]);

  // 根据窗口 label 分派渲染：spotlight 窗口渲染独立的聚光灯 UI
  const isSpotlight = thisWindowLabel() === "spotlight";

  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        {isSpotlight ? (
          // Spotlight 窗口不需要等待认证，直接渲染 SpotlightApp
          <SpotlightApp />
        ) : ready ? (
          // 已就绪：认证则进主界面，否则登录界面（多用户登出/切换）
          authed ? (
            <AppRouter />
          ) : (
            <LoginScreen />
          )
        ) : (
          <div className="flex h-screen items-center justify-center bg-background text-foreground">
            <div className="space-y-2 text-center">
              {error ? (
                <>
                  <div className="text-destructive">错误</div>
                  <div className="text-sm text-muted-foreground">{error}</div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">启动中…</div>
              )}
            </div>
          </div>
        )}
        {/* 全局 toast（sonner） */}
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
