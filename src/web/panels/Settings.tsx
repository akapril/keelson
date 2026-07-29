/**
 * Settings.tsx — Web 端设置栏
 *
 * 只放 web 端真正有用且安全的项（宿主机配置如网关开关/AI 密钥/后端不下放到远程 web）：
 *   - 语言：复用桌面 LanguageSection（纯前端 i18n）。
 *   - 主题：浅色 / 深色 / 跟随系统（复用 ThemeProvider 的 useTheme）。
 *   - 关于：应用名 / 版本 / 当前地址 / 连接状态。
 *
 * 颜色全用语义色 token；文案走 web i18n 命名空间。
 */
import { useTranslation } from "react-i18next";
import { LanguageSection } from "@/features/settings/LanguageSection";
import { useTheme } from "@/components/theme-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** 主题选择区：跟随系统 / 浅色 / 深色。复用全局 ThemeProvider（localStorage 持久化）。 */
function ThemeSection() {
  const { t } = useTranslation("web");
  const { theme, setTheme } = useTheme();
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("settings.theme.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("settings.theme.desc")}
        </p>
      </div>
      <Select value={theme} onValueChange={(v) => setTheme(v as typeof theme)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="system">{t("settings.theme.system")}</SelectItem>
          <SelectItem value="light">{t("settings.theme.light")}</SelectItem>
          <SelectItem value="dark">{t("settings.theme.dark")}</SelectItem>
        </SelectContent>
      </Select>
    </section>
  );
}

/** 关于区：应用名 / 版本 / 当前地址 / 连接状态（纯展示，无副作用）。 */
function AboutSection() {
  const { t } = useTranslation("web");
  // 当前访问地址（host:port）；已能渲染本组件即代表 gateway 连接正常。
  const host = typeof location !== "undefined" ? location.host : "";
  const rows: { label: string; value: string }[] = [
    { label: t("settings.about.app"), value: "Keelson" },
    { label: t("settings.about.version"), value: __APP_VERSION__ },
    { label: t("settings.about.address"), value: host },
    { label: t("settings.about.status"), value: t("settings.about.connected") },
  ];
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{t("settings.about.title")}</h2>
      <dl className="rounded-md border border-border">
        {rows.map((r, i) => (
          <div
            key={r.label}
            className={`flex items-center justify-between gap-3 px-3 py-2 text-xs ${
              i > 0 ? "border-t border-border" : ""
            }`}
          >
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="truncate font-mono text-foreground" title={r.value}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Web 端设置栏主组件。 */
export function Settings() {
  return (
    <div className="mx-auto h-full max-w-3xl space-y-6 overflow-y-auto p-4">
      <LanguageSection />
      <ThemeSection />
      <AboutSection />
    </div>
  );
}
