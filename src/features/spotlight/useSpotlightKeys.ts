// useSpotlightKeys.ts — Spotlight 键盘导航钩子
// ↑/↓ 移动选中项、Enter 恢复会话、Esc 隐藏窗口、Tab 切换恢复模式（新终端 / 标签页）
import { useEffect } from "react";
import { useSpotlightStore } from "../../store/spotlight";
import { hideThisWindow } from "../../lib/tauri/window";
import { activateItem } from "./activate";

export function useSpotlightKeys() {
  const move = useSpotlightStore((s) => s.move);
  const items = useSpotlightStore((s) => s.items);
  const selectedIndex = useSpotlightStore((s) => s.selectedIndex);
  const asTab = useSpotlightStore((s) => s.asTab);
  const toggleAsTab = useSpotlightStore((s) => s.toggleAsTab);

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
          // Tab → 切换恢复模式（新终端窗 / 标签页）
          e.preventDefault();
          toggleAsTab();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [move, items, selectedIndex, asTab, toggleAsTab]);
}
