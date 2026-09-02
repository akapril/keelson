// web 端「日历」面板：直接复用桌面 CalendarPage（事件走 PB 两端通用；今日活动/回顾走 /api/git_log）。
// 用 MemoryRouter 兜住 CalendarPage 的 useNavigate/NavLink 依赖——web shell 无主路由，
// 其内部「跳看板/会话」的导航在 web 版为惰性 no-op（无对应路由），不影响日历本身全部功能。
import { MemoryRouter } from "react-router-dom";
import CalendarPage from "@/features/calendar/CalendarPage";

export function CalendarPanel() {
  return (
    <MemoryRouter>
      <div className="h-full overflow-hidden">
        <CalendarPage />
      </div>
    </MemoryRouter>
  );
}
