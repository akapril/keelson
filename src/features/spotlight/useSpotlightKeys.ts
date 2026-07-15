// useSpotlightKeys.ts — Spotlight 键盘导航钩子
// 处理 ↑/↓ 移动选中项、Enter 恢复会话、Esc 隐藏窗口、Tab 切换恢复模式
import { useEffect, useRef } from "react";
import { useSpotlightStore } from "../../store/spotlight";
import { useRestoreStore } from "../../store/restore";
import { hideThisWindow } from "../../lib/tauri/window";

export function useSpotlightKeys() {
  const move = useSpotlightStore((s) => s.move);
  const items = useSpotlightStore((s) => s.items);
  const selectedIndex = useSpotlightStore((s) => s.selectedIndex);
  const restore = useRestoreStore((s) => s.restore);

  // Tab 模式：true = 新窗口（标签页）打开，false = 当前会话（新终端）
  const asTabRef = useRef(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp":
          // 向上移动选中项
          e.preventDefault();
          move("up");
          break;

        case "ArrowDown":
          // 向下移动选中项
          e.preventDefault();
          move("down");
          break;

        case "Enter": {
          // 恢复当前选中的会话
          e.preventDefault();
          const selected = items[selectedIndex];
          if (selected) {
            // 恢复会话后隐藏 Spotlight 窗口
            restore(selected.session, asTabRef.current).then(() => {
              hideThisWindow();
            });
          }
          break;
        }

        case "Escape":
          // Esc → 隐藏 Spotlight 窗口
          e.preventDefault();
          hideThisWindow();
          break;

        case "Tab":
          // Tab → 切换恢复模式（新窗口 / 当前窗口）
          e.preventDefault();
          asTabRef.current = !asTabRef.current;
          break;

        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [move, items, selectedIndex, restore]);

  return { asTab: asTabRef.current };
}
