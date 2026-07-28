import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Logo } from "@/components/logo";
import { PairScreen } from "./PairScreen";
import { Workbench } from "./panels/Workbench";
import type { Session } from "@/types/session";

// 标识符：UI 标记，真凭证是 httpOnly cookie（JS 无法读取）
const PAIRED_KEY = "kln_web_paired";

/**
 * 认证过期处理：清除 UI 配对标记并刷新页面以触发重新配对。
 * 后续 Task 中受保护请求收到 401 时调用此函数。
 */
export function onAuthExpired(): void {
  localStorage.removeItem(PAIRED_KEY);
  window.location.reload();
}

/** 4 栏 tab 标识 */
type TabKey = "workspace" | "terminal" | "notifications" | "settings";

const TABS: TabKey[] = ["workspace", "terminal", "notifications", "settings"];

/** 各 tab 的 SVG 图标（内联，避免额外依赖） */
function TabIcon({ tab, active }: { tab: TabKey; active: boolean }) {
  const cls = `size-5 transition-colors ${active ? "text-foreground" : "text-muted-foreground"}`;
  switch (tab) {
    case "workspace":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 21V9" />
        </svg>
      );
    case "terminal":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M7 12l3-3-3 3 3 3M13 15h4" />
        </svg>
      );
    case "notifications":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      );
    case "settings":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
  }
}

/** 已配对后的 4 栏布局：大屏左侧栏（参考桌面侧栏），移动窄屏底部 tab。 */
function MainLayout() {
  const { t } = useTranslation("web");
  const [activeTab, setActiveTab] = useState<TabKey>("workspace");
  // 用户从工作台选中的会话（供终端 tab 占位显示；Task 13 实现真正的终端内容）
  const [_selectedSession, setSelectedSession] = useState<Session | null>(null);

  /** 工作台点击会话：记录选中 + 切换到终端 tab */
  function handleOpenTerminal(session: Session) {
    setSelectedSession(session);
    setActiveTab("terminal");
  }

  /** 渲染当前 tab 的内容区 */
  function renderTabContent() {
    switch (activeTab) {
      case "workspace":
        return <Workbench onOpenTerminal={handleOpenTerminal} />;
      default:
        return (
          <div className="mx-auto flex h-full max-w-3xl items-center justify-center px-4">
            <p className="text-sm text-muted-foreground">
              {t(`tabs.${activeTab}`)} — {t("placeholder.comingSoon")}
            </p>
          </div>
        );
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* 大屏：左侧导航栏（≥lg 显示，参考桌面侧栏） */}
      <aside
        className="hidden w-56 shrink-0 flex-col border-r border-border lg:flex"
        aria-label={t("nav.main")}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <Logo className="size-6" />
          <span className="text-sm font-semibold">Keelson</span>
        </div>
        <nav className="flex flex-col gap-1 px-2">
          {TABS.map((tab) => {
            const isActive = tab === activeTab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <TabIcon tab={tab} active={isActive} />
                <span>{t(`tabs.${tab}`)}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* 内容区 + 窄屏底部 tab */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-hidden">{renderTabContent()}</main>

        {/* 移动窄屏：底部 tab 栏（<lg 显示，大屏用左侧栏） */}
        <nav
          className="border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:hidden"
          aria-label={t("nav.main")}
        >
          <div className="mx-auto flex max-w-3xl">
            {TABS.map((tab) => {
              const isActive = tab === activeTab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex flex-1 flex-col items-center gap-1 px-2 py-2.5 text-xs transition-colors ${
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <TabIcon tab={tab} active={isActive} />
                  <span>{t(`tabs.${tab}`)}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}

/** Web 入口根组件：检测配对状态，分派 PairScreen / MainLayout */
export function WebApp() {
  const [paired, setPaired] = useState(
    () => localStorage.getItem(PAIRED_KEY) === "1"
  );

  function handlePaired() {
    setPaired(true);
  }

  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        {paired ? <MainLayout /> : <PairScreen onPaired={handlePaired} />}
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
