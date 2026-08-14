// SpotlightList.tsx — 候选项列表：键盘/鼠标高亮、鼠标悬停跟随选中、点击恢复会话。
import { useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowTurnBackwardIcon, InboxIcon } from "@hugeicons/core-free-icons";
import { useSpotlightStore } from "../../store/spotlight";
import { activateItem } from "./activate";
import { cn } from "../../lib/utils";

// 非会话候选（任务/文档/项目/记忆）的徽标样式与 i18n key
const KIND_BADGE: Record<"task" | "doc" | "project" | "memory", { cls: string; key: string }> = {
  task: { cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", key: "spotlight.kindTask" },
  doc: { cls: "bg-violet-500/15 text-violet-600 dark:text-violet-400", key: "spotlight.kindDoc" },
  project: { cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400", key: "spotlight.kindProject" },
  memory: { cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400", key: "spotlight.kindMemory" },
};

export function SpotlightList() {
  const { t } = useTranslation("shell");
  const items = useSpotlightStore((s) => s.items);
  const selectedIndex = useSpotlightStore((s) => s.selectedIndex);
  const asTab = useSpotlightStore((s) => s.asTab);
  const setSelectedIndex = useSpotlightStore((s) => s.setSelectedIndex);
  const listRef = useRef<HTMLDivElement>(null);

  // 键盘移动选中项时滚动到可见区域（鼠标悬停不触发滚动，避免抖动）
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const selected = container.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-muted-foreground">
        <HugeiconsIcon icon={InboxIcon} strokeWidth={1.5} className="size-8 opacity-50" />
        <span className="text-sm">{t("spotlight.empty")}</span>
      </div>
    );
  }

  return (
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
      {items.map((item, idx) => {
        const isSelected = idx === selectedIndex;
        // key：会话用 session_id；任务/文档用 kind+path+idx（path 可能跨条重复，idx 保唯一）
        const key = item.kind === "session" ? `s:${item.session.session_id}` : `${item.kind}:${idx}`;
        return (
          <div
            key={key}
            role="option"
            aria-selected={isSelected}
            onMouseEnter={() => setSelectedIndex(idx)}
            onClick={() => void activateItem(item, asTab)}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors",
              isSelected ? "bg-[var(--item-selected)]" : "hover:bg-[var(--item-selected)]/60",
            )}
          >
            {item.kind === "session" ? (
              <>
                {/* provider 徽章 */}
                <span
                  className={cn(
                    "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    item.session.provider === "claude"
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "bg-sky-500/15 text-sky-600 dark:text-sky-400",
                  )}
                >
                  {item.session.provider}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-foreground">
                    {item.session.project_name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.session.first_prompt || item.session.last_prompt || item.session.session_id}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* 任务/文档/项目/记忆 类型徽标 */}
                <span
                  className={cn(
                    "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                    KIND_BADGE[item.kind].cls,
                  )}
                >
                  {t(KIND_BADGE[item.kind].key)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-foreground">{item.label}</div>
                </div>
              </>
            )}

            {/* 选中项显示回车提示 */}
            {isSelected && (
              <HugeiconsIcon
                icon={ArrowTurnBackwardIcon}
                strokeWidth={2}
                className="size-4 shrink-0 text-muted-foreground"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
