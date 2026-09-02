// web 端「看板/项目」面板：复用桌面 Board 页（项目列表 → 打开 → ProjectWorkspace）。
// 看板任务视图纯 PB，两端通用。⚠️ 项目工作台里的 git/终端/会话子 tab 靠 IPC，web 上点击会降级
// （对应 /api 未路由 → 报错/空），但挂载安全（ProjectWorkspace 挂载只调 PB）、默认落「看板」tab。
// MemoryRouter 承载 /board（?open=<id> 深链走 store 打开工作台）；等 pbReady 再挂载。
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Board from "@/pages/board";

export function BoardPanel({ pbReady }: { pbReady: boolean }) {
  const { t } = useTranslation("web");
  if (!pbReady) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-muted-foreground">{t("pbInit.loading")}</span>
      </div>
    );
  }
  return (
    <MemoryRouter initialEntries={["/board"]}>
      <div className="h-full overflow-hidden">
        <Routes>
          <Route path="/board" element={<Board />} />
        </Routes>
      </div>
    </MemoryRouter>
  );
}
