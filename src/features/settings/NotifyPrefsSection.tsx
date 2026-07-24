// 通知偏好区（从 pages/settings.tsx 拆出，逻辑逐字保留）。
// 逐类型开关（铃铛 + 桌面），可独立关闭任意来源；「发现新会话」保留旧独立开关。
import { useState } from "react";
import {
  newSessionsPref,
  setNewSessionsPref,
} from "@/features/notifications/new-sessions";
import { NOTIF_TYPES, useNotifPrefsStore } from "@/store/notification-prefs";

export function NotifyPrefsSection() {
  // 旧的会话摘要开关（独立 localStorage key）
  const [newSessions, setNewSessions] = useState(newSessionsPref());
  const toggleNewSessions = (v: boolean) => {
    setNewSessions(v);
    setNewSessionsPref(v);
  };

  // 新的逐类型偏好 store
  const prefs = useNotifPrefsStore((s) => s.prefs);
  const setEnabled = useNotifPrefsStore((s) => s.setEnabled);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">通知偏好</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          控制哪些类型的通知写入铃铛/收件箱，以及是否弹出桌面系统通知。
          关闭后，该类型既不创建也不显示（含外部 Agent 写入的同类型通知）。
        </p>
      </div>

      {/* 逐类型开关 */}
      <div className="space-y-2">
        {NOTIF_TYPES.map(({ source, label }) => {
          const enabled = prefs[source] !== false;
          return (
            <label
              key={source}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent/40"
            >
              <span className="select-none">{label}</span>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(source, e.target.checked)}
                className="h-3.5 w-3.5 shrink-0 accent-primary"
              />
            </label>
          );
        })}
      </div>

      {/* 旧：会话摘要粒度控制（启动时是否推摘要条；与"会话"类型开关叠加） */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">会话提醒细粒度</p>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={newSessions}
            onChange={(e) => toggleNewSessions(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-input accent-primary"
          />
          <span>发现新的本地 CLI 会话时提醒（启动时汇总一条，需「会话」类型也开启才生效）</span>
        </label>
      </div>
    </section>
  );
}
