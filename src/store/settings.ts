import { create } from "zustand";
import { ipc } from "../lib/tauri/ipc";

// ── Store 状态类型 ─────────────────────────────────────────
interface SettingsState {
  /** 全局唤起快捷键（如 "CmdOrCtrl+Shift+Space"） */
  hotkey: string;
  /** 工作区路径（本地状态，暂不持久化到后端） */
  workspacePath: string;
  loading: boolean;
  error?: string;
  /** 从 Tauri 后端加载设置 */
  load: () => Promise<void>;
  /** 保存快捷键到 Tauri 后端 */
  saveHotkey: (h: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  hotkey: "",
  workspacePath: "",
  loading: false,
  error: undefined,

  load: async () => {
    set({ loading: true, error: undefined });
    try {
      const hotkey = await ipc.getHotkey();
      set({ hotkey, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  saveHotkey: async (h: string) => {
    set({ loading: true, error: undefined });
    try {
      await ipc.setHotkey(h);
      set({ hotkey: h, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
}));
