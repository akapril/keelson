// 看板已完成任务自动归档阈值设置区（从 pages/settings.tsx 拆出，逻辑逐字保留）。
// 完成超过 N 天的任务在打开项目时自动归档（保留溯源，不删除）。0 = 关闭。纯本地偏好。
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
  getAutoArchiveDays,
  setAutoArchiveDays,
} from "@/features/board/task-archive";

// value → i18n key 映射（冻结内部值，只翻 UI 展示）
const AUTO_ARCHIVE_OPTIONS: { value: string; i18nKey: string }[] = [
  { value: "0",  i18nKey: "off" },
  { value: "3",  i18nKey: "days3" },
  { value: "7",  i18nKey: "days7" },
  { value: "14", i18nKey: "days14" },
  { value: "30", i18nKey: "days30" },
];

export function AutoArchiveSection() {
  const { t } = useTranslation("settings");
  const [days, setDays] = useState<string>(() => String(getAutoArchiveDays()));
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("autoArchive.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("autoArchive.desc")}
        </p>
      </div>
      <Select
        value={days}
        onValueChange={(v) => {
          setDays(v);
          setAutoArchiveDays(Number(v));
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("autoArchive.placeholder")} />
        </SelectTrigger>
        <SelectContent>
          {AUTO_ARCHIVE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {t(`autoArchive.options.${opt.i18nKey}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}
