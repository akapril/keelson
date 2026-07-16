// SpotlightList.tsx — 候选项列表：键盘/鼠标高亮、鼠标悬停跟随选中、点击恢复会话。
import { useRef, useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowTurnBackwardIcon, InboxIcon } from "@hugeicons/core-free-icons";
import { useSpotlightStore } from "../../store/spotlight";
import { activateItem } from "./activate";
import { cn } from "../../lib/utils";

export function SpotlightList() {
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
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-muted-foreground">
        <HugeiconsIcon icon={InboxIcon} strokeWidth={1.5} className="size-8 opacity-50" />
        <span className="text-sm">没有匹配的会话</span>
      </div>
    );
  }

  return (
    <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
      {items.map((item, idx) => {
        const isSelected = idx === selectedIndex;
        const provider = item.session.provider;
        return (
          <div
            key={item.session.session_id}
            role="option"
            aria-selected={isSelected}
            onMouseEnter={() => setSelectedIndex(idx)}
            onClick={() => void activateItem(item, asTab)}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors",
              isSelected ? "bg-[var(--item-selected)]" : "hover:bg-[var(--item-selected)]/60",
            )}
          >
            {/* provider 徽章 */}
            <span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                provider === "claude"
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "bg-sky-500/15 text-sky-600 dark:text-sky-400",
              )}
            >
              {provider}
            </span>

            {/* 项目名 + 会话摘要 */}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-foreground">
                {item.session.project_name}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {item.session.first_prompt || item.session.last_prompt || item.session.session_id}
              </div>
            </div>

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
