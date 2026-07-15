// SpotlightInput.tsx — 搜索输入框，挂载时及窗口每次获得焦点时自动聚焦
import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSpotlightStore } from "../../store/spotlight";

export function SpotlightInput() {
  const query = useSpotlightStore((s) => s.query);
  const setQuery = useSpotlightStore((s) => s.setQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  // 组件挂载时自动聚焦（首次显示）
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 每次 Spotlight 窗口重新获得焦点（即热键再次唤起窗口）时：
  // 1. 重新聚焦输入框并全选已有文字，方便用户直接覆盖输入
  // 2. 重置选中索引到第一项，保持列表从顶部开始
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          const el = inputRef.current;
          if (el) {
            el.focus();
            el.select(); // 全选已有内容，使新输入直接覆盖
          }
          // 重置列表选中索引到第一项
          useSpotlightStore.setState({ selectedIndex: 0 });
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    // 组件卸载时取消监听，防止内存泄漏
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <div
      style={{
        padding: "16px 16px 12px",
        borderBottom: "1px solid var(--glass-border)",
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索会话…"
        autoComplete="off"
        spellCheck={false}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          outline: "none",
          fontSize: "18px",
          color: "var(--foreground)",
          caretColor: "var(--primary)",
        }}
      />
    </div>
  );
}
