// SpotlightInput.tsx — 搜索输入框，挂载时自动聚焦
import { useEffect, useRef } from "react";
import { useSpotlightStore } from "../../store/spotlight";

export function SpotlightInput() {
  const query = useSpotlightStore((s) => s.query);
  const setQuery = useSpotlightStore((s) => s.setQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  // 组件挂载时自动聚焦（Spotlight 窗口每次显示后均需重新聚焦）
  useEffect(() => {
    inputRef.current?.focus();
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
