import { createContext, useContext, useEffect, useState } from "react";
type Theme = "light" | "dark" | "system";
const KEY = "rework-theme";
const Ctx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: "system", setTheme: () => {},
});
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(KEY) as Theme) || "system",
  );
  useEffect(() => {
    const root = document.documentElement;
    const sys = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = theme === "dark" || (theme === "system" && sys);
    root.classList.toggle("dark", dark);
    localStorage.setItem(KEY, theme);
  }, [theme]);
  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);
