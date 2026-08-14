// useSpotlightKeys.ts — Spotlight 键盘导航钩子
// ↑/↓ 移动选中项、Enter 恢复会话、Esc 隐藏窗口
// Tab/Shift+Tab 循环切类别、⌘1..6/Ctrl1..6 直达类别
import { useEffect } from "react";
import { useSpotlightStore, CATEGORIES } from "../../store/spotlight";
import { hideThisWindow } from "../../lib/tauri/window";
import { activateItem } from "./activate";

export function useSpotlightKeys() {
  const move = useSpotlightStore((s) => s.move);
  const items = useSpotlightStore((s) => s.items);
  const selectedIndex = useSpotlightStore((s) => s.selectedIndex);
  const asTab = useSpotlightStore((s) => s.asTab);
  const cycleCategory = useSpotlightStore((s) => s.cycleCategory);
  const setCategory = useSpotlightStore((s) => s.setCategory);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          move("up");
          break;
        case "ArrowDown":
          e.preventDefault();
          move("down");
          break;
        case "Enter": {
          e.preventDefault();
          const selected = items[selectedIndex];
          if (selected) void activateItem(selected, asTab);
          break;
        }
        case "Escape":
          e.preventDefault();
          hideThisWindow();
          break;
        case "Tab":
          // Tab / Shift+Tab → 循环切换类别（原恢复模式切换迁移至底栏徽标点击）
          e.preventDefault();
          cycleCategory(e.shiftKey ? "prev" : "next");
          break;
        default:
          // ⌘1..6 / Ctrl1..6 → 直达第 1..6 个类别
          if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "6") {
            e.preventDefault();
            setCategory(CATEGORIES[Number(e.key) - 1]);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [move, items, selectedIndex, asTab, cycleCategory, setCategory]);
}
