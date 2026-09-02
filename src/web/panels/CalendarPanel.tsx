// web 端「日历」面板：直接复用桌面 CalendarPage（事件走 PB 两端通用；今日活动/回顾走 /api/git_log）。
// 用 MemoryRouter 兜住 CalendarPage 的 useNavigate/NavLink 依赖——web shell 无主路由，
// 其内部「跳看板/会话」的导航在 web 版为惰性 no-op（无对应路由），不影响日历本身全部功能。
//
// ⚠️ 必须等 pbReady 再挂载 CalendarPage：所有 TabPane 常驻挂载，而 React 子 effect 先于父 effect，
// 若不 gate，CalendarPage 的 useCalendarStore.load() 会抢在 WebApp.initPbAuth 设好 pb.baseURL 之前
// 发出请求，打到占位 baseURL(127.0.0.1:0) 而失败。
import { MemoryRouter } from "react-router-dom";
import { useTranslation } from "react-i18next";
import CalendarPage from "@/features/calendar/CalendarPage";

export function CalendarPanel({ pbReady }: { pbReady: boolean }) {
  const { t } = useTranslation("web");
  if (!pbReady) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-muted-foreground">{t("pbInit.loading")}</span>
      </div>
    );
  }
  return (
    <MemoryRouter>
      <div className="h-full overflow-hidden">
        <CalendarPage />
      </div>
    </MemoryRouter>
  );
}
