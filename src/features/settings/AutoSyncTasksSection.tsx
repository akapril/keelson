// 看板自动同步开关（从 pages/settings.tsx 拆出，逻辑逐字保留）。
// Claude 会话的 TaskCreate/TaskUpdate 经活动 hook 到达时是否自动同步进匹配项目看板。纯本地偏好。
import { useState } from "react";
import {
  getAutoSyncTasks,
  setAutoSyncTasks,
} from "@/features/board/auto-sync-pref";

export function AutoSyncTasksSection() {
  const [on, setOn] = useState<boolean>(() => getAutoSyncTasks());
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">看板自动同步（CLI 任务）</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          开启后，Claude 会话里建/改任务（TaskCreate/TaskUpdate）会实时同步进其关联项目的看板。
          关掉则不自动同步，仍可在会话预览手动点「同步任务」。依赖上方「实时活动 hook」已启用。
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
        <span>自动同步 CLI 任务到看板</span>
      </label>
    </section>
  );
}
