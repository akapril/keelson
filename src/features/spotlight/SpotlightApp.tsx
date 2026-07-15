// SpotlightApp.tsx — Spotlight 窗口根组件
// 玻璃面板（glass panel），使用 CSS 变量实现透明模糊效果，支持明暗主题
import { useEffect } from "react";
import { useSpotlightStore } from "../../store/spotlight";
import { useSessionsStore } from "../../store/sessions";
import { recentSessions, filterSessions, sessionToItem } from "./utils";
import { SpotlightInput } from "./SpotlightInput";
import { SpotlightList } from "./SpotlightList";
import { useSpotlightKeys } from "./useSpotlightKeys";

/** Spotlight 主容器：玻璃面板 + 输入框 + 候选项列表 */
export function SpotlightApp() {
  // 加载会话数据
  const sessions = useSessionsStore((s) => s.sessions);
  const loadSessions = useSessionsStore((s) => s.load);
  const query = useSpotlightStore((s) => s.query);
  const setItems = useSpotlightStore((s) => s.setItems);

  // 挂载时拉取会话列表
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // query 或 sessions 变化时重新计算候选项
  useEffect(() => {
    const filtered = query.trim()
      ? filterSessions(sessions, query)
      : recentSessions(sessions, 20);
    setItems(filtered.map(sessionToItem));
  }, [query, sessions, setItems]);

  // 注册键盘事件（↑/↓/Enter/Esc/Tab）
  useSpotlightKeys();

  return (
    // 外层撑满窗口，透明背景（窗口本身 transparent:true）
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "60px",
        background: "transparent",
      }}
    >
      {/* 玻璃面板：使用 --glass-surface / --glass-blur 主题变量，禁止硬编码颜色 */}
      <div
        role="dialog"
        aria-label="Spotlight 搜索"
        style={{
          width: "600px",
          background: "var(--glass-surface)",
          backdropFilter: `blur(var(--glass-blur))`,
          WebkitBackdropFilter: `blur(var(--glass-blur))`,
          border: "1px solid var(--glass-border)",
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: "0 8px 32px color-mix(in oklab, var(--foreground) 12%, transparent)",
        }}
      >
        {/* 搜索输入框（自动聚焦） */}
        <SpotlightInput />
        {/* 候选项列表（键盘导航高亮） */}
        <SpotlightList />
      </div>
    </div>
  );
}
