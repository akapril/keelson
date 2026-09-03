// Web 远程访问功能开关（按能力分组）。
// - 桌面端（Tauri）：全开——桌面拥有完整能力，开关只对 web 远程访问生效。
// - web 端：由 /api/bootstrap_auth 响应里的 features 覆盖（网关按位放行 /api/*）。
// 组件据此隐藏未启用能力，避免空跑 403/404。
import { create } from "zustand";

export interface WebFeatures {
  /** 会话浏览（/api/sessions_list）——工作台基础能力，始终开 */
  sessions: boolean;
  /** 日历「今日活动 / 回顾」的 git 活动读取（/api/git_log） */
  activity: boolean;
  /** AI 日报 / 对话（/api/ai_chat，占位，路由后续接入） */
  ai: boolean;
  /** 看板 tab（/pb board_* 集合） */
  board: boolean;
  /** 日历 tab（/pb calendar_events 集合） */
  calendar: boolean;
  /** 文档 tab（/pb docs 集合） */
  docs: boolean;
  /** 终端 tab（/ws/terminal 远程 PTY，最敏感） */
  terminal: boolean;
}

interface WebFeaturesState {
  features: WebFeatures;
  setFeatures: (f: WebFeatures) => void;
}

export const useWebFeaturesStore = create<WebFeaturesState>((set) => ({
  // 桌面端默认全开；web 端 bootstrap 后覆盖
  features: {
    sessions: true,
    activity: true,
    ai: true,
    board: true,
    calendar: true,
    docs: true,
    terminal: true,
  },
  setFeatures: (features) => set({ features }),
}));
