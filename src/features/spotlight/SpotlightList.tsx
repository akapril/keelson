// SpotlightList.tsx — 候选项列表，高亮当前选中项
import { useRef, useEffect } from "react";
import { useSpotlightStore } from "../../store/spotlight";

export function SpotlightList() {
  const items = useSpotlightStore((s) => s.items);
  const selectedIndex = useSpotlightStore((s) => s.selectedIndex);
  const listRef = useRef<HTMLDivElement>(null);

  // 选中项变更时自动滚动到可见区域
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const selected = container.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0) {
    return (
      <div
        style={{
          padding: "24px 16px",
          textAlign: "center",
          color: "var(--muted-foreground)",
          fontSize: "14px",
        }}
      >
        没有匹配的会话
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      style={{
        overflowY: "auto",
        maxHeight: "320px",
        padding: "8px 8px",
      }}
    >
      {items.map((item, idx) => {
        const isSelected = idx === selectedIndex;
        return (
          <div
            key={item.session.session_id}
            role="option"
            aria-selected={isSelected}
            style={{
              padding: "10px 12px",
              borderRadius: "var(--radius)",
              background: isSelected ? "var(--item-selected)" : "transparent",
              cursor: "pointer",
              transition: "background 0.1s",
            }}
          >
            {/* 项目名称 */}
            <div
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--foreground)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.session.project_name}
            </div>
            {/* 会话摘要 */}
            <div
              style={{
                fontSize: "12px",
                color: "var(--muted-foreground)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                marginTop: "2px",
              }}
            >
              {item.session.first_prompt}
            </div>
          </div>
        );
      })}
    </div>
  );
}
