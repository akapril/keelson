import { useEffect, useState } from "react";
import { ThemeProvider } from "./components/theme-provider";
import { ThemeToggle } from "./components/theme-toggle";
import { useAuthStore } from "./store/auth";
import { ipc } from "./lib/tauri/ipc";

export default function App() {
  const { ready, error, init } = useAuthStore();
  const [pong, setPong] = useState("");
  useEffect(() => { init(); ipc.ping().then(setPong); }, [init]);
  return (
    <ThemeProvider>
      <div className="min-h-screen p-6">
        <div className="flex items-center justify-between">
          <span className="text-lg">rework</span><ThemeToggle />
        </div>
        <ul className="mt-6 space-y-1 text-sm text-muted-foreground">
          <li>Tauri IPC: {pong === "pong" ? "✓ 通" : "…"}</li>
          <li>PocketBase: {ready ? "✓ 已登录" : error ? `✗ ${error}` : "…"}</li>
        </ul>
      </div>
    </ThemeProvider>
  );
}
