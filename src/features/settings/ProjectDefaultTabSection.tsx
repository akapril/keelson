// 项目默认打开标签页设置区（从 pages/settings.tsx 拆出，逻辑逐字保留）。
// 设全局兜底默认；打开项目时优先级：深链 ?tab= > 项目上次停留 > 此处默认。纯本地偏好。
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  WORKSPACE_TABS,
  getDefaultTab,
  setDefaultTab,
  type WorkspaceTab,
} from "@/features/board/project-tab-pref";

export function ProjectDefaultTabSection() {
  const { t } = useTranslation("settings");
  const [tab, setTab] = useState<WorkspaceTab>(() => getDefaultTab());
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("projectDefaultTab.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("projectDefaultTab.desc")}
        </p>
      </div>
      <Select
        value={tab}
        onValueChange={(v) => {
          const next = v as WorkspaceTab;
          setTab(next);
          setDefaultTab(next);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("projectDefaultTab.placeholder")} />
        </SelectTrigger>
        <SelectContent>
          {WORKSPACE_TABS.map((tabItem) => (
            <SelectItem key={tabItem.value} value={tabItem.value}>
              {t(`projectDefaultTab.tabs.${tabItem.value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}
