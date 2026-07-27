// 工作区路径设置区（从 pages/settings.tsx 拆出，逻辑逐字保留）。
// MVP 阶段仅本地编辑，不持久化后端（沿用原设计）。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/store/settings";

export function WorkspacePathSection() {
  const { t } = useTranslation("settings");
  const workspacePath = useSettingsStore((s) => s.workspacePath);
  // 本地工作区路径编辑状态（不直接写 store 的 workspacePath 避免频繁触发渲染）
  const [localPath, setLocalPath] = useState(workspacePath);

  // 当 store 中的 workspacePath 更新时同步本地状态
  useEffect(() => {
    setLocalPath(workspacePath);
  }, [workspacePath]);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("workspacePath.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("workspacePath.desc")}
        </p>
      </div>

      <input
        type="text"
        aria-label={t("workspacePath.ariaLabel")}
        placeholder={t("workspacePath.placeholder")}
        value={localPath}
        onChange={(e) => setLocalPath(e.target.value)}
        className={[
          "w-full rounded-md border border-input bg-background px-3 py-1.5",
          "text-sm text-foreground placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring",
        ].join(" ")}
      />

      <p className="text-xs text-muted-foreground">
        {t("workspacePath.hint")}
      </p>
    </section>
  );
}
