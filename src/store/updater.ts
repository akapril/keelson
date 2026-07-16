// 应用更新（tauri-plugin-updater）：检查 → 下载安装 → 重启。
// 未配置 endpoint/pubkey 或离线时优雅静默（silent 检查不报错、不显红标）。
import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// 待安装的 Update 句柄（非可序列化，模块级持有）
let pending: Update | null = null;

interface UpdaterState {
  /** 是否发现可用更新（红标依据） */
  available: boolean;
  version: string;
  notes: string;
  checking: boolean;
  installing: boolean;
  error?: string;
  /** 检查更新；silent=true 时失败不记录 error（用于自启动后台检查） */
  checkForUpdate: (opts?: { silent?: boolean }) => Promise<void>;
  /** 下载并安装找到的更新，成功后重启应用 */
  installAndRestart: () => Promise<void>;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  available: false,
  version: "",
  notes: "",
  checking: false,
  installing: false,
  error: undefined,

  checkForUpdate: async (opts) => {
    if (get().checking || get().installing) return;
    set({ checking: true, error: undefined });
    try {
      const update = await check();
      if (update) {
        pending = update;
        set({ available: true, version: update.version, notes: update.body ?? "" });
      } else {
        pending = null;
        set({ available: false, version: "", notes: "" });
      }
    } catch (e) {
      // 未配置更新源 / 网络失败：静默（手动检查时才暴露 error）
      if (!opts?.silent) set({ error: String(e) });
    } finally {
      set({ checking: false });
    }
  },

  installAndRestart: async () => {
    if (!pending || get().installing) return;
    set({ installing: true, error: undefined });
    try {
      await pending.downloadAndInstall();
      await relaunch();
    } catch (e) {
      set({ error: String(e), installing: false });
    }
  },
}));
