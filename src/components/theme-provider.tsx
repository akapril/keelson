/* eslint-disable react-refresh/only-export-components */
// 主题 Provider —— 移植自 workavera（Apache-2.0），已剥离其后端持久化耦合。
// 纯 localStorage + class-based `.dark`；支持 system 跟随、`d` 键快捷切换、跨标签页同步、切换时抑制过渡。
import * as React from "react";

type Theme = "dark" | "light" | "system";
type ResolvedTheme = "dark" | "light";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  disableTransitionOnChange?: boolean;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";
const THEME_VALUES: Theme[] = ["dark", "light", "system"];

const ThemeProviderContext = React.createContext<ThemeProviderState | undefined>(
  undefined,
);

function isTheme(value: string | null): value is Theme {
  if (value === null) return false;
  return THEME_VALUES.includes(value as Theme);
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? "dark" : "light";
}

// 切换主题瞬间临时禁用全局过渡，避免颜色渐变闪烁。
function disableTransitionsTemporarily() {
  const style = document.createElement("style");
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}",
    ),
  );
  document.head.appendChild(style);
  return () => {
    window.getComputedStyle(document.body);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => style.remove());
    });
  };
}

// 判断事件目标是否为可编辑元素（输入中时不触发 `d` 快捷键）。
function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return !!target.closest(
    "input, textarea, select, [contenteditable='true']",
  );
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "rework-theme",
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    const stored = localStorage.getItem(storageKey);
    return isTheme(stored) ? stored : defaultTheme;
  });

  const setTheme = React.useCallback(
    (nextTheme: Theme) => {
      localStorage.setItem(storageKey, nextTheme);
      setThemeState(nextTheme);
    },
    [storageKey],
  );

  const applyTheme = React.useCallback(
    (nextTheme: Theme) => {
      const root = document.documentElement;
      const resolved = nextTheme === "system" ? getSystemTheme() : nextTheme;
      const restore = disableTransitionOnChange
        ? disableTransitionsTemporarily()
        : null;
      root.classList.remove("light", "dark");
      root.classList.add(resolved);
      if (restore) restore();
    },
    [disableTransitionOnChange],
  );

  // 应用主题 + system 模式下监听系统偏好变化
  React.useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return undefined;
    const mq = window.matchMedia(COLOR_SCHEME_QUERY);
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme, applyTheme]);

  // 全局 `d` 键快捷切换明暗
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (event.key.toLowerCase() !== "d") return;
      setThemeState((current) => {
        const next =
          current === "dark"
            ? "light"
            : current === "light"
              ? "dark"
              : getSystemTheme() === "dark"
                ? "light"
                : "dark";
        localStorage.setItem(storageKey, next);
        return next;
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [storageKey]);

  // 跨标签页同步
  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return;
      if (event.key !== storageKey) return;
      setThemeState(isTheme(event.newValue) ? event.newValue : defaultTheme);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [defaultTheme, storageKey]);

  const value = React.useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = React.useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
