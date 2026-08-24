import { create } from "zustand";
import { ipc } from "../lib/tauri/ipc";
import type { Session } from "../types/session";
import { getResumeAsTab } from "../features/sessions/resume-pref";

// ── Store 状态类型 ─────────────────────────────────────────
interface RestoreState {
  loading: boolean;
  error?: string;
  /** 恢复（打开）会话终端（显式指定 新窗/标签） */
  restore: (session: Session, asTab: boolean) => Promise<void>;
  /** 一键恢复：按记住的「新窗 vs 标签」偏好接续，供各入口统一调用 */
  resume: (session: Session) => Promise<void>;
  /** 清除错误状态（切换会话时调用，避免旧错误残留） */
  clearError: () => void;
}

export const useRestoreStore = create<RestoreState>((set, get) => ({
  loading: false,
  error: undefined,

  restore: async (session: Session, asTab: boolean) => {
    set({ loading: true, error: undefined });
    try {
      await ipc.restore(session.provider, session.project_path, session.session_id, asTab);
      set({ loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  // 读本机偏好（默认新窗）后走同一 restore 逻辑；偏好的更新由调用方（会话卡右键菜单）负责
  resume: (session: Session) => get().restore(session, getResumeAsTab()),

  clearError: () => set({ error: undefined }),
}));
