import { ThemeProvider } from "./components/theme-provider";
import { ThemeToggle } from "./components/theme-toggle";
export default function App() {
  return (
    <ThemeProvider>
      <div className="min-h-screen p-6">
        <div className="flex items-center justify-between">
          <span className="text-lg">rework</span>
          <ThemeToggle />
        </div>
      </div>
    </ThemeProvider>
  );
}
