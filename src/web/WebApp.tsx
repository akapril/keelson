import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Logo } from "@/components/logo";
import { initPbAuth } from "@/lib/pb";
import { listNotifications } from "@/lib/pb/notifications";
import { PairScreen } from "./PairScreen";
import { Workbench } from "./panels/Workbench";
import { BoardPanel } from "./panels/BoardPanel";
import { CalendarPanel } from "./panels/CalendarPanel";
import { DocsPanel } from "./panels/DocsPanel";
import { Notifications } from "./panels/Notifications";
import { Terminal } from "./panels/Terminal";
import { Settings } from "./panels/Settings";
import { isPaired, handleAuthExpired } from "./auth-expiry";
import { TabIcon, CONTENT_TABS, UTILITY_TABS, normalizeTabOrder, type TabKey } from "./tabs";
import { MobileTabBar } from "./MobileTabBar";
import type { Session } from "@/types/session";

// 认证过期处理收口到 auth-expiry 模块（ipc/pb 收 401 时调用）；此处保留具名导出兼容既有引用。
export const onAuthExpired = handleAuthExpired;

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

/** 已配对后的布局：顶栏（通知/设置）+ 主体（桌面侧栏 / 移动底栏，均只列内容 tab）。 */
function MainLayout() {
  const { t } = useTranslation("web");
  // activeTab / selectedSession 持久化到 localStorage：刷新后回到原 tab 并自动重连回原终端会话。
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const v = localStorage.getItem("keelson-web-tab") as TabKey | null;
    const all: TabKey[] = [...CONTENT_TABS, ...UTILITY_TABS];
    return v && all.includes(v) ? v : "workspace";
  });
  // 移动底栏内容 tab 顺序（可拖拽排序，持久化）。normalize 兜底旧数据/增删 tab。
  const [tabOrder, setTabOrder] = useState<TabKey[]>(() => {
    try {
      return normalizeTabOrder(JSON.parse(localStorage.getItem("keelson-web-tab-order") ?? "null"));
    } catch {
      return normalizeTabOrder(null);
    }
  });
  // 已打开的终端会话列表（多终端 tab）+ 当前活动终端 id。刷新后按列表逐个重连（各自回放历史）。
  const [openTerminals, setOpenTerminals] = useState<Session[]>(() => {
    try {
      const raw = localStorage.getItem("keelson-web-terminals");
      return raw ? (JSON.parse(raw) as Session[]) : [];
    } catch {
      return [];
    }
  });
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(
    () => localStorage.getItem("keelson-web-active-terminal") || null,
  );
  // 通知未读数（顶栏徽标）。web 端通知只读，pbReady 后拉一次即可。
  const [unreadCount, setUnreadCount] = useState(0);

  // 记住当前 tab / 终端列表 / 活动终端 / 底栏顺序
  useEffect(() => {
    localStorage.setItem("keelson-web-tab", activeTab);
  }, [activeTab]);
  useEffect(() => {
    localStorage.setItem("keelson-web-terminals", JSON.stringify(openTerminals));
  }, [openTerminals]);
  useEffect(() => {
    if (activeTerminalId) localStorage.setItem("keelson-web-active-terminal", activeTerminalId);
    else localStorage.removeItem("keelson-web-active-terminal");
  }, [activeTerminalId]);
  useEffect(() => {
    localStorage.setItem("keelson-web-tab-order", JSON.stringify(tabOrder));
  }, [tabOrder]);

  // PB 初始化状态（web 分支全程 fetch，不调 invoke）
  const [pbReady, setPbReady] = useState(false);
  // 移动端软键盘弹出会盖住底部（终端输入行等）：跟随 visualViewport 收缩+顶起根容器，
  // 让整个界面落到键盘之上、输入行可见（终端会随容器变小 fit 到更少行）。
  const [vp, setVp] = useState<{ height: number; offsetTop: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setVp({ height: vv.height, offsetTop: vv.offsetTop });
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // mount 时初始化 PB 认证（web 分支：baseURL→/pb 反代 + /api/bootstrap_auth 取 token）
  useEffect(() => {
    initPbAuth()
      .then(() => setPbReady(true))
      .catch((e) => {
        console.error("[WebApp] PB 初始化失败:", e);
        toast.error(t("pbInit.error"));
        setPbReady(true);
      });
  }, [t]);

  // pbReady 后拉未读通知数（顶栏徽标）。失败静默（徽标不显）。
  useEffect(() => {
    if (!pbReady) return;
    let cancelled = false;
    listNotifications()
      .then((items) => {
        if (!cancelled) setUnreadCount(items.filter((n) => !n.read).length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pbReady]);

  /** 工作台点击会话：加入终端列表（已开则切过去）+ 切到终端 tab */
  function handleOpenTerminal(session: Session) {
    setOpenTerminals((prev) =>
      prev.some((s) => s.session_id === session.session_id) ? prev : [...prev, session],
    );
    setActiveTerminalId(session.session_id);
    setActiveTab("terminal");
  }
  /** 关闭一个终端 tab：仅从列表移除（断该 WS；后端 PTY 仍在，可再从工作台打开重连） */
  function closeTerminal(id: string) {
    setOpenTerminals((prev) => {
      const next = prev.filter((s) => s.session_id !== id);
      setActiveTerminalId((cur) => (cur === id ? (next[0]?.session_id ?? null) : cur));
      return next;
    });
  }

  return (
    <div
      className="flex h-screen flex-col bg-background text-foreground"
      style={
        vp
          ? { height: vp.height, ...(vp.offsetTop ? { transform: `translateY(${vp.offsetTop}px)` } : {}) }
          : undefined
      }
    >
      {/* 顶栏：logo/名 + 右上工具入口（通知带未读徽标 / 设置） */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <Logo className="size-6" />
          <span className="text-sm font-semibold">Keelson</span>
        </div>
        <div className="flex items-center gap-1">
          {UTILITY_TABS.map((tab) => {
            const isActive = tab === activeTab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                aria-current={isActive ? "page" : undefined}
                aria-label={t(`tabs.${tab}`)}
                title={t(`tabs.${tab}`)}
                className={`relative flex size-9 items-center justify-center rounded-md transition-colors ${
                  isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <TabIcon tab={tab} active={isActive} />
                {/* 通知未读徽标 */}
                {tab === "notifications" && unreadCount > 0 && (
                  <span
                    className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-4 text-white"
                    aria-label={t("notifications.unreadBadgeLabel", { count: unreadCount })}
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* 主体：桌面左侧栏（内容 tab）+ 内容区；移动端底栏在内容区下方 */}
      <div className="flex min-h-0 flex-1">
        {/* 大屏：左侧导航栏（≥lg 显示），只列内容 tab */}
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border py-2 lg:flex" aria-label={t("nav.main")}>
          <nav className="flex flex-col gap-1 px-2">
            {CONTENT_TABS.map((tab) => {
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
          {/* 内容区：全部常驻挂载，仅切显隐（见 TabPane 注释）。终端因此 WS 不断、缓冲不丢。 */}
          <main className="min-h-0 flex-1 overflow-hidden">
            <TabPane active={activeTab === "workspace"}>
              <Workbench onOpenTerminal={handleOpenTerminal} />
            </TabPane>
            <TabPane active={activeTab === "board"}>
              <BoardPanel pbReady={pbReady} />
            </TabPane>
            <TabPane active={activeTab === "calendar"}>
              <CalendarPanel pbReady={pbReady} />
            </TabPane>
            <TabPane active={activeTab === "docs"}>
              <DocsPanel pbReady={pbReady} />
            </TabPane>
            <TabPane active={activeTab === "terminal"}>
              <Terminal
                terminals={openTerminals}
                activeId={activeTerminalId}
                onSelect={setActiveTerminalId}
                onClose={closeTerminal}
              />
            </TabPane>
            <TabPane active={activeTab === "notifications"}>
              <Notifications pbReady={pbReady} />
            </TabPane>
            <TabPane active={activeTab === "settings"}>
              <Settings />
            </TabPane>
          </main>

          {/* 移动窄屏：底部内容 tab 栏（<lg 显示），可长按拖拽排序 */}
          <MobileTabBar
            order={tabOrder}
            activeTab={activeTab}
            onSelect={setActiveTab}
            onReorder={setTabOrder}
            label={(tab) => t(`tabs.${tab}`)}
            ariaLabel={t("nav.main")}
          />
        </div>
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
