import { useEffect } from "react";
import { ThemeProvider } from "./components/theme-provider";
import { useAuthStore } from "./store/auth";
import { AppRouter } from "./router";

export default function App() {
  const { ready, error, init } = useAuthStore();

  useEffect(() => {
    init();
  }, [init]);

  return (
    <ThemeProvider>
      {ready ? (
        <AppRouter />
      ) : (
        <div className="flex h-screen items-center justify-center bg-background text-foreground">
          <div className="space-y-2 text-center">
            {error ? (
              <>
                <div className="text-destructive">错误</div>
                <div className="text-sm text-muted-foreground">{error}</div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">启动中…</div>
            )}
          </div>
        </div>
      )}
    </ThemeProvider>
  );
}
