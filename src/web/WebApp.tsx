import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Logo } from "@/components/logo";
import { initPbAuth } from "@/lib/pb";
import { PairScreen } from "./PairScreen";
import { Workbench } from "./panels/Workbench";
import { BoardPanel } from "./panels/BoardPanel";
import { CalendarPanel } from "./panels/CalendarPanel";
import { DocsPanel } from "./panels/DocsPanel";
import { Notifications } from "./panels/Notifications";
import { Terminal } from "./panels/Terminal";
import { Settings } from "./panels/Settings";
import { isPaired, handleAuthExpired } from "./auth-expiry";
import type { Session } from "@/types/session";

// 认证过期处理收口到 auth-expiry 模块（ipc/pb 收 401 时调用）；此处保留具名导出兼容既有引用。
export const onAuthExpired = handleAuthExpired;

/** tab 标识 */
type TabKey =
  | "workspace"
  | "board"
  | "calendar"
  | "docs"
  | "terminal"
  | "notifications"
  | "settings";

const TABS: TabKey[] = [
  "workspace",
  "board",
  "calendar",
  "docs",
  "terminal",
  "notifications",
  "settings",
];

// 移动端底栏分流：常用直排 + 其余收进「更多」，避免 7 个挤成一排（桌面侧栏仍列全部）
const PRIMARY_TABS: TabKey[] = ["workspace", "board", "calendar", "docs"];
const MORE_TABS: TabKey[] = ["terminal", "notifications", "settings"];

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
    case "board":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18M15 3v18" />
        </svg>
      );
    case "docs":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M8 13h8M8 17h8M8 9h2" />
        </svg>
      );
    case "calendar":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
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

/**
 * Tab 内容容器：非激活时用 `hidden`（display:none）隐藏，而非从树上卸载。
 *
 * 终端面板尤其依赖此常驻语义：若切走 tab 就卸载 XtermView，会触发其清理
 * `ws.close() + term.dispose()` —— WS 断开、xterm 滚动缓冲全丢（切回来黑屏），
 * 且断连期间 agent 继续输出会灌满 PTY 内核缓冲致 writer 阻塞、agent 卡死。
 * 保持挂载后切 tab 仅切显隐：WS 持续、缓冲保留、reader 一直在读，从根上避免上述问题。
 */
function TabPane({ active, children }: { active: boolean; children: ReactNode }) {
  return <div className={active ? "h-full" : "hidden"}>{children}</div>;
}

/** 已配对后的 4 栏布局：大屏左侧栏（参考桌面侧栏），移动窄屏底部 tab。 */
function MainLayout() {
  const { t } = useTranslation("web");
  const [activeTab, setActiveTab] = useState<TabKey>("workspace");
  // 用户从工作台选中的会话（Task 13：真正消费，传入 Terminal 面板）
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  // PB 初始化状态（web 分支全程 fetch，不调 invoke）
  const [pbReady, setPbReady] = useState(false);
  // 移动端「更多」弹层开合
  const [moreOpen, setMoreOpen] = useState(false);

  // mount 时初始化 PB 认证（web 分支：baseURL→/pb 反代 + /api/bootstrap_auth 取 token）
  useEffect(() => {
    initPbAuth()
      .then(() => setPbReady(true))
      .catch((e) => {
        // PB 初始化失败：toast 提示，但允许工作台（走 /api 非 PB）继续使用
        console.error("[WebApp] PB 初始化失败:", e);
        toast.error(t("pbInit.error"));
        // 标记 ready，使 tab 可切换（工作台不依赖 PB，通知栏内部会显示错误态）
        setPbReady(true);
      });
  }, [t]);

  /** 工作台点击会话：记录选中 + 切换到终端 tab */
  function handleOpenTerminal(session: Session) {
    setSelectedSession(session);
    setActiveTab("terminal");
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
        {/* 四栏内容区：全部常驻挂载，仅切显隐（见 TabPane 注释）。终端因此 WS 不断、缓冲不丢。 */}
        <main className="min-h-0 flex-1 overflow-hidden">
          <TabPane active={activeTab === "workspace"}>
            <Workbench onOpenTerminal={handleOpenTerminal} />
          </TabPane>
          <TabPane active={activeTab === "board"}>
            <BoardPanel pbReady={pbReady} />
          </TabPane>
          <TabPane active={activeTab === "calendar"}>
            {/* 等 pbReady 再挂载：避免抢在 initPbAuth 设好 baseURL 之前发 PB 请求 */}
            <CalendarPanel pbReady={pbReady} />
          </TabPane>
          <TabPane active={activeTab === "docs"}>
            <DocsPanel pbReady={pbReady} />
          </TabPane>
          <TabPane active={activeTab === "terminal"}>
            {/* Task 13：接入真实终端面板，传入当前选中会话 */}
            <Terminal session={selectedSession} />
          </TabPane>
          <TabPane active={activeTab === "notifications"}>
            {/* PB 未就绪时展示加载态（initPbAuth 通常 <1s，失败时 pbReady 也置 true） */}
            <Notifications pbReady={pbReady} />
          </TabPane>
          <TabPane active={activeTab === "settings"}>
            <Settings />
          </TabPane>
        </main>

        {/* 移动窄屏：底部 tab 栏（<lg 显示，大屏用左侧栏）。常用直排 + 「更多」收纳 terminal/通知/设置 */}
        <nav
          className="relative border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:hidden"
          aria-label={t("nav.main")}
        >
          {/* 「更多」弹层：浮在底栏上方；点遮罩关闭 */}
          {moreOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-10 cursor-default"
                aria-hidden
                onClick={() => setMoreOpen(false)}
              />
              <div className="absolute bottom-full right-2 z-20 mb-1 w-44 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                {MORE_TABS.map((tab) => {
                  const isActive = tab === activeTab;
                  return (
                    <button
                      key={tab}
                      onClick={() => {
                        setActiveTab(tab);
                        setMoreOpen(false);
                      }}
                      aria-current={isActive ? "page" : undefined}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
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
              </div>
            </>
          )}
          <div className="mx-auto flex max-w-3xl">
            {PRIMARY_TABS.map((tab) => {
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
            {/* 更多：收纳 terminal/通知/设置；当前若在其中则高亮 */}
            {(() => {
              const moreActive = MORE_TABS.includes(activeTab);
              return (
                <button
                  type="button"
                  onClick={() => setMoreOpen((o) => !o)}
                  aria-expanded={moreOpen}
                  className={`flex flex-1 flex-col items-center gap-1 px-2 py-2.5 text-xs transition-colors ${
                    moreActive || moreOpen
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <svg
                    className={`size-5 transition-colors ${moreActive || moreOpen ? "text-foreground" : "text-muted-foreground"}`}
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden
                  >
                    <circle cx="5" cy="12" r="1.75" />
                    <circle cx="12" cy="12" r="1.75" />
                    <circle cx="19" cy="12" r="1.75" />
                  </svg>
                  <span>{t("tabs.more")}</span>
                </button>
              );
            })()}
          </div>
        </nav>
      </div>
    </div>
  );
}

/** Web 入口根组件：检测配对状态，分派 PairScreen / MainLayout */
export function WebApp() {
  const [paired, setPaired] = useState(() => isPaired());

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
