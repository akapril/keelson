import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ThemeProvider } from "./components/theme-provider";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";
import { useAuthStore } from "./store/auth";
import { useUpdaterStore } from "./store/updater";
import { AppRouter } from "./router";
import { thisWindowLabel } from "./lib/tauri/window";
import { SpotlightApp } from "./features/spotlight/SpotlightApp";
import { LoginScreen } from "./features/auth/LoginScreen";
import { TitleBar } from "./components/title-bar";

export default function App() {
  const { t } = useTranslation("shell");
  const { ready, authed, error, init } = useAuthStore();

  useEffect(() => {
    init();
  }, [init]);

  // 根据窗口 label 分派渲染：spotlight 窗口渲染独立的聚光灯 UI
  const isSpotlight = thisWindowLabel() === "spotlight";

  // 主窗口：启动即静默查更新，并每 6 小时定时复查（长时间不关也能发现新版本）。
  // 未配置更新源时静默失败，不显红标；仅窗口可见时复查，避免后台无谓请求。
  useEffect(() => {
    if (isSpotlight) return;
    const check = () => void useUpdaterStore.getState().checkForUpdate({ silent: true });
    check(); // 启动查一次
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, SIX_HOURS);
    return () => clearInterval(id);
  }, [isSpotlight]);


  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        {isSpotlight ? (
          // Spotlight 窗口不需要等待认证，也无自建标题栏，直接渲染 SpotlightApp
          <SpotlightApp />
        ) : (
          // 主窗口：顶部自建标题栏 + 其余内容（覆盖 加载/登录/主界面 各状态）
          <div className="flex h-screen flex-col overflow-hidden bg-background">
            <TitleBar />
            <div className="min-h-0 flex-1 overflow-hidden">
              {ready ? (
                authed ? (
                  <AppRouter />
                ) : (
                  <LoginScreen />
                )
              ) : (
                <div className="flex h-full items-center justify-center text-foreground">
                  <div className="space-y-2 text-center">
                    {error ? (
                      <>
                        <div className="text-destructive">{t("app.error")}</div>
                        <div className="text-sm text-muted-foreground">{error}</div>
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">{t("app.loading")}</div>
                    )}
                  </div>
                </div>
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
