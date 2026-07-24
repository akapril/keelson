// 项目默认打开标签页设置区（从 pages/settings.tsx 拆出，逻辑逐字保留）。
// 设全局兜底默认；打开项目时优先级：深链 ?tab= > 项目上次停留 > 此处默认。纯本地偏好。
import { useState } from "react";
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
  const [tab, setTab] = useState<WorkspaceTab>(() => getDefaultTab());
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">项目默认打开标签页</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          打开一个项目时默认停留的标签页。系统会自动记住每个项目上次停留的位置并优先回到那里；
          此处仅作为「从未打开过」时的兜底默认。
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
          <SelectValue placeholder="选择默认标签页" />
        </SelectTrigger>
        <SelectContent>
          {WORKSPACE_TABS.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}
