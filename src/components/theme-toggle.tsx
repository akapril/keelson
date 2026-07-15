import { useTheme } from "./theme-provider";
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <button
      className="rounded-md border border-border px-3 py-1 text-sm"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? "☾ 暗" : "☀ 明"}
    </button>
  );
}
