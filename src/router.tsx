import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { DashboardLayout } from "./components/dashboard-layout";
import Dashboard from "./pages/dashboard";
import Sessions from "./pages/sessions";
import Settings from "./pages/settings";
import Board from "./pages/board";
import DocsPage from "./pages/docs";
import ReadingPage from "./features/reading/ReadingPage";
import CalendarPage from "./features/calendar/CalendarPage";
import UsagePage from "./pages/usage";
import InboxPage from "./pages/inbox";
import MemoryPage from "./pages/memory";

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
