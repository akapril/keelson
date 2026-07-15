import { Outlet } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { ThemeToggle } from "../theme-toggle";

export function MainWindowLayout() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <AppSidebar />
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-sm font-medium">rework</span>
          <ThemeToggle />
        </header>
        <main className="flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
