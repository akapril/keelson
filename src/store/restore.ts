import { create } from "zustand";
import { ipc } from "../lib/tauri/ipc";
import type { Session } from "../types/session";

// ── Store 状态类型 ─────────────────────────────────────────
interface RestoreState {
  loading: boolean;
  error?: string;
  /** 恢复（打开）会话终端 */
  restore: (session: Session, asTab: boolean) => Promise<void>;
}

export const useRestoreStore = create<RestoreState>((set) => ({
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
}));
