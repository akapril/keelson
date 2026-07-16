import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { DashboardLayout } from "./components/dashboard-layout";
import Sessions from "./pages/sessions";
import Settings from "./pages/settings";
import Board from "./pages/board";
import ReadingPage from "./features/reading/ReadingPage";
import CalendarPage from "./features/calendar/CalendarPage";

export function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/board" element={<Board />} />
          <Route path="/reading" element={<ReadingPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/sessions" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
