import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { MainWindowLayout } from "./components/layout/MainWindowLayout";
import Sessions from "./pages/sessions";
import Settings from "./pages/settings";

export function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<MainWindowLayout />}>
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/sessions" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
