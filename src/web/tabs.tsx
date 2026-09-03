// web/tabs.tsx — web 栏 tab 定义与图标（供 WebApp 顶栏/侧栏 + MobileTabBar 复用）
//
// IA：内容 tab（工作台/看板/日历/文档/终端）走主导航（桌面侧栏 / 移动底栏）；
// 工具 tab（通知/设置）走顶栏右上（见 WebApp）。抽到此处避免 WebApp ↔ MobileTabBar 循环依赖。

import type { WebFeatures } from "@/store/web-features";

/** 全部 tab 标识 */
export type TabKey =
  | "workspace"
  | "board"
  | "calendar"
  | "docs"
  | "terminal"
  | "notifications"
  | "settings";

/** 内容 tab（主导航：桌面侧栏 + 移动底栏）。移动底栏正好放下 5 个，无需「更多」溢出。 */
export const CONTENT_TABS: TabKey[] = ["workspace", "board", "calendar", "docs", "terminal"];

/** 工具 tab（顶栏右上入口）。 */
export const UTILITY_TABS: TabKey[] = ["notifications", "settings"];

/** 各 tab 的内联描边 SVG 图标（Lucide/Feather 风格，无额外依赖）。 */
export function TabIcon({ tab, active }: { tab: TabKey; active: boolean }) {
  const cls = `size-5 transition-colors ${active ? "text-foreground" : "text-muted-foreground"}`;
  switch (tab) {
    case "workspace":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 21V9" />
        </svg>
      );
    case "board":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18M15 3v18" />
        </svg>
      );
    case "docs":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M8 13h8M8 17h8M8 9h2" />
        </svg>
      );
    case "calendar":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      );
    case "terminal":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M7 12l3-3-3 3 3 3M13 15h4" />
        </svg>
      );
    case "notifications":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      );
    case "settings":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
  }
}

/**
 * 内容 tab 是否启用（web 功能开关门控）。workspace/工具 tab 无 flag=始终显示；
 * board/calendar/docs/terminal 各对应一个 WebFeatures flag。桌面端 features 全 true。
 */
export function isTabEnabled(tab: TabKey, features: WebFeatures): boolean {
  switch (tab) {
    case "board":
      return features.board;
    case "calendar":
      return features.calendar;
    case "docs":
      return features.docs;
    case "terminal":
      return features.terminal;
    default:
      return true; // workspace（工作台基础）/ notifications / settings 始终可见
  }
}

/**
 * 校正持久化的移动底栏 tab 顺序：过滤未知项 + 补上缺失项（以 CONTENT_TABS 为准）。
 * 保证后续增删内容 tab 时，旧的本地顺序不会漏显或残留脏值。
 */
export function normalizeTabOrder(saved: unknown): TabKey[] {
  const arr = Array.isArray(saved) ? (saved as TabKey[]) : [];
  const valid = arr.filter((t) => CONTENT_TABS.includes(t));
  const missing = CONTENT_TABS.filter((t) => !valid.includes(t));
  return [...valid, ...missing];
}
