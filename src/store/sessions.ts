import { create } from "zustand";
import { ipc } from "../lib/tauri/ipc";
import { on } from "../lib/tauri/events";
import type { Session } from "../types/session";

// 是否已注册后端「会话已更新」事件监听（模块级，仅注册一次）
let listening = false;

// ── 纯函数辅助：按 project_path 分组 ──────────────────────
/** 将会话列表按 project_path 分组，返回 Record<string, Session[]> */
export function groupByProject(sessions: Session[]): Record<string, Session[]> {
  const result: Record<string, Session[]> = {};
  for (const s of sessions) {
    const key = s.project_path;
    if (!result[key]) result[key] = [];
    result[key].push(s);
  }
  return result;
}

// ── 视图模式 ──────────────────────────────────────────────
export type ViewMode = "list" | "grouped";

// ── Store 状态类型 ─────────────────────────────────────────
interface SessionsState {
  sessions: Session[];
  /** 按 project_path 分组的会话（由 load() 自动计算） */
  groups: Record<string, Session[]>;
  viewMode: ViewMode;
  loading: boolean;
  error?: string;
  /** 从 Tauri 后端加载全部会话 */
  load: () => Promise<void>;
  /** 切换列表 / 分组视图 */
  setViewMode: (mode: ViewMode) => void;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: [],
  groups: {},
  viewMode: "list",
  loading: false,
  error: undefined,

  load: async () => {
    // 首次 load 时注册后端事件监听：修复启动首帧抢在后台扫描完成前取到空列表的问题
    // （后端完成首次扫描 / 文件变化后 emit "sessions-updated" → 自动重载）。
    if (!listening) {
      listening = true;
      void on("sessions-updated", () => {
        void useSessionsStore.getState().load();
      }).catch(() => {
        // 非 Tauri 环境（如测试）忽略
      });
    }
    set({ loading: true, error: undefined });
    try {
      const sessions = await ipc.listSessions();
      set({ sessions, groups: groupByProject(sessions), loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  setViewMode: (viewMode) => set({ viewMode }),
}));
