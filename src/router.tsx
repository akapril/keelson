import { lazy, Suspense } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { DashboardLayout } from "./components/dashboard-layout";

// 路由懒加载：重型页面（recharts/milkdown/codemirror 等）按需加载，加快首屏启动。
// 布局(DashboardLayout)保持同步以立即渲染外壳；页面在 <Suspense> 下延迟加载。
const Dashboard = lazy(() => import("./pages/dashboard"));
const Sessions = lazy(() => import("./pages/sessions"));
const Settings = lazy(() => import("./pages/settings"));
const Board = lazy(() => import("./pages/board"));
const DocsPage = lazy(() => import("./pages/docs"));
const DocPage = lazy(() => import("./pages/doc"));
const ReadingPage = lazy(() => import("./features/reading/ReadingPage"));
const CalendarPage = lazy(() => import("./features/calendar/CalendarPage"));
const UsagePage = lazy(() => import("./pages/usage"));
const InboxPage = lazy(() => import("./pages/inbox"));
const MemoryPage = lazy(() => import("./pages/memory"));
const PromptsPage = lazy(() => import("./pages/prompts"));
const ReportPage = lazy(() => import("./pages/report"));
const ProcessesPage = lazy(() => import("./pages/processes"));

export function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        {/* 独立文档窗口：无原生边框、无侧栏；DocPage 头部本身充当标题栏(可拖拽+窗口控制) */}
        <Route
          path="/doc-window/:id"
          element={
            <div className="h-screen">
              <Suspense fallback={null}>
                <DocPage windowMode />
              </Suspense>
            </div>
          }
        />
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/board" element={<Board />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:id" element={<DocPage />} />
          <Route path="/reading" element={<ReadingPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="/processes" element={<ProcessesPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
