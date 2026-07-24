// 看板已完成任务自动归档阈值设置区（从 pages/settings.tsx 拆出，逻辑逐字保留）。
// 完成超过 N 天的任务在打开项目时自动归档（保留溯源，不删除）。0 = 关闭。纯本地偏好。
import { useState } from "react";
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

const AUTO_ARCHIVE_OPTIONS = [
  { value: "0", label: "关闭（仅手动归档）" },
  { value: "3", label: "完成 3 天后" },
  { value: "7", label: "完成 7 天后" },
  { value: "14", label: "完成 14 天后" },
  { value: "30", label: "完成 30 天后" },
];

export function AutoArchiveSection() {
  const [days, setDays] = useState<string>(() => String(getAutoArchiveDays()));
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">看板已完成任务自动归档</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          打开项目时，把「完成」列中停留超过所选天数的任务自动归档（软删除、保留会话/提交溯源，
          默认从看板隐藏，可随时「显示归档」查看或取消归档）。不会删除任何数据。
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
          <SelectValue placeholder="选择自动归档时机" />
        </SelectTrigger>
        <SelectContent>
          {AUTO_ARCHIVE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}
