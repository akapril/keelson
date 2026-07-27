// 看板自动同步开关（从 pages/settings.tsx 拆出，逻辑逐字保留）。
// Claude 会话的 TaskCreate/TaskUpdate 经活动 hook 到达时是否自动同步进匹配项目看板。纯本地偏好。
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getAutoSyncTasks,
  setAutoSyncTasks,
} from "@/features/board/auto-sync-pref";

export function AutoSyncTasksSection() {
  const { t } = useTranslation("settings");
  const [on, setOn] = useState<boolean>(() => getAutoSyncTasks());
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("autoSyncTasks.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("autoSyncTasks.desc")}
        </p>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm select-none">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            setAutoSyncTasks(e.target.checked);
          }}
          className="size-4 cursor-pointer rounded border-input accent-primary"
        />
        <span>{t("autoSyncTasks.checkboxLabel")}</span>
      </label>
    </section>
  );
}
