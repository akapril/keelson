// 主题切换按钮 —— 移植自 workavera（Apache-2.0），已剥离其后端持久化。
import { HugeiconsIcon } from "@hugeicons/react";
import { Moon02Icon, Sun02Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle() {
  const { t } = useTranslation("shell");
  const { theme, setTheme } = useTheme();

  // 解析当前是否为暗色（system 时读系统偏好）
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          aria-label={t("themeToggle.ariaLabel")}
        >
          <HugeiconsIcon icon={isDark ? Sun02Icon : Moon02Icon} strokeWidth={2} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {t("themeToggle.tooltip", { key: "d" })}
      </TooltipContent>
    </Tooltip>
  );
}
