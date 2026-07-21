// 应用更新（tauri-plugin-updater）：检查 → 下载安装 → 重启。
// 未配置 endpoint/pubkey 或离线时优雅静默（silent 检查不报错、不显红标）。
import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { useNotificationsStore } from "./notifications";
import { osNotify } from "../lib/os-notify";
import { isTypeEnabled } from "./notification-prefs";

// 待安装的 Update 句柄（非可序列化，模块级持有）
let pending: Update | null = null;
// 本会话已就该版本推过通知（避免重复检查时反复推）
let notifiedVersion = "";
// 本会话已就该版本自动弹过升级窗（避免重复检查反复弹）
let autoOpenedVersion = "";

/** 发现新版本时推一条通知（应用内 + 系统弹窗），按版本去重。 */
async function pushUpdateNotification(version: string, notes: string) {
  if (!version || version === notifiedVersion) return;
  notifiedVersion = version;
  const mark = `nkey=update-${version}`;
  // 跨会话去重：通知已存在则不重复建
  const exists = useNotificationsStore
    .getState()
    .items.some((n) => n.link.includes(mark));
  if (!exists) {
    await useNotificationsStore
      .getState()
      .add({
        title: `有新版本 ${version}`,
        body: notes.slice(0, 120) || "前往设置更新到最新版",
        kind: "info",
        source: "更新",
        link: `/settings?${mark}`,
      })
      .catch(() => {});
  }
  // 桌面弹窗遵循"更新"类型偏好
  if (isTypeEnabled("更新")) {
    void osNotify("rework 有新版本", `v${version} 可更新`);
  }
}

interface UpdaterState {
  /** 是否发现可用更新（红标依据） */
  available: boolean;
  version: string;
  /** 当前已安装版本（用于弹窗版本对比） */
  currentVersion: string;
  notes: string;
  checking: boolean;
  installing: boolean;
  /** 下载进度 0-100（installing 期间有效） */
  progress: number;
  /** 升级弹窗是否打开 */
  dialogOpen: boolean;
  error?: string;
  /** 检查更新；silent=true 时失败不记录 error（用于自启动后台检查） */
  checkForUpdate: (opts?: { silent?: boolean }) => Promise<void>;
  /** 下载并安装找到的更新（带进度），成功后重启应用 */
  installAndRestart: () => Promise<void>;
  /** 打开 / 关闭升级弹窗 */
  openDialog: () => void;
  closeDialog: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  available: false,
  version: "",
  currentVersion: "",
  notes: "",
  checking: false,
  installing: false,
  progress: 0,
  dialogOpen: false,
  error: undefined,

  checkForUpdate: async (opts) => {
    if (get().checking || get().installing) return;
    set({ checking: true, error: undefined });
    try {
      // 当前版本（弹窗版本对比用）；失败不阻断
      const cur = await getVersion().catch(() => "");
      const update = await check();
      if (update) {
        pending = update;
        set({
          available: true,
          version: update.version,
          currentVersion: cur,
          notes: update.body ?? "",
        });
        // 发现更新 → 推通知（应用内 + 系统弹窗），按版本去重
        void pushUpdateNotification(update.version, update.body ?? "");
        // 发现新版本 → 自动弹升级窗（每版本仅一次，用户关掉不再自动弹）
        if (update.version !== autoOpenedVersion) {
          autoOpenedVersion = update.version;
          set({ dialogOpen: true });
        }
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
    set({ installing: true, progress: 0, error: undefined });
    try {
      let total = 0;
      let downloaded = 0;
      await pending.downloadAndInstall((e) => {
        // 下载进度事件：Started(总长) → Progress(增量) → Finished
        if (e.event === "Started") {
          total = e.data.contentLength ?? 0;
          downloaded = 0;
        } else if (e.event === "Progress") {
          downloaded += e.data.chunkLength;
          set({ progress: total ? Math.min(99, Math.round((downloaded / total) * 100)) : 0 });
        } else if (e.event === "Finished") {
          set({ progress: 100 });
        }
      });
      await relaunch();
    } catch (e) {
      set({ error: String(e), installing: false });
    }
  },

  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
}));
