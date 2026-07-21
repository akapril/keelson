import { lazy } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { DashboardLayout } from "./components/dashboard-layout";

// 路由懒加载：重型页面（recharts/milkdown/codemirror 等）按需加载，加快首屏启动。
// 布局(DashboardLayout)保持同步以立即渲染外壳；页面在 <Suspense> 下延迟加载。
const Dashboard = lazy(() => import("./pages/dashboard"));
const Sessions = lazy(() => import("./pages/sessions"));
const Settings = lazy(() => import("./pages/settings"));
const Board = lazy(() => import("./pages/board"));
const DocsPage = lazy(() => import("./pages/docs"));
const ReadingPage = lazy(() => import("./features/reading/ReadingPage"));
const CalendarPage = lazy(() => import("./features/calendar/CalendarPage"));
const UsagePage = lazy(() => import("./pages/usage"));
const InboxPage = lazy(() => import("./pages/inbox"));
const MemoryPage = lazy(() => import("./pages/memory"));

export function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/board" element={<Board />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/reading" element={<ReadingPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
