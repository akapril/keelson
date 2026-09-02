// web 端「文档」面板：复用桌面 DocsPage(列表) + DocPage(编辑器)，纯 PB 两端通用。
// MemoryRouter 提供 /docs 与 /docs/:id 两条内部路由，使「列表→打开→编辑→返回」在面板内闭环。
// 等 pbReady 再挂载，避免抢在 initPbAuth 设 baseURL 前发 PB 请求（见 CalendarPanel 注释）。
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useTranslation } from "react-i18next";
import DocsPage from "@/pages/docs";
import DocPage from "@/pages/doc";

export function DocsPanel({ pbReady }: { pbReady: boolean }) {
  const { t } = useTranslation("web");
  if (!pbReady) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-muted-foreground">{t("pbInit.loading")}</span>
      </div>
    );
  }
  return (
    <MemoryRouter initialEntries={["/docs"]}>
      <div className="h-full overflow-hidden">
        <Routes>
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:id" element={<DocPage />} />
        </Routes>
      </div>
    </MemoryRouter>
  );
}
