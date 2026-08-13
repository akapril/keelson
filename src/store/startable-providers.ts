import { create } from "zustand";
import { ipc } from "../lib/tauri/ipc";

// 「能起新会话」的 provider 列表（其 CLI 二进制在 PATH）。
// 由后端 list_startable_providers 提供，全局缓存一次，避免每个「新建会话」控件各拉一遍 IPC。
// web 环境该命令 404 → ensureLoaded 静默吞错，列表保持空（控件禁用 + 提示）。

/** 单个可起会话的 provider */
export interface StartableProvider {
  id: string;
  label: string;
}

interface StartableProvidersState {
  /** 已拉取到的可起 provider（未加载时为空数组） */
  providers: StartableProvider[];
  /** 是否已完成首次加载（区分「加载中的空」与「确实无可用 CLI」） */
  loaded: boolean;
  /** 首次拉取（幂等：已加载或正在加载则不重复请求） */
  ensureLoaded: () => Promise<void>;
  /** 强制重拉（供需要刷新的场景，如安装了新 CLI 后） */
  refresh: () => Promise<void>;
}

// 进行中的加载 Promise（模块级，避免并发首帧多次触发 IPC）
let inflight: Promise<void> | null = null;

export const useStartableProvidersStore = create<StartableProvidersState>((set, get) => {
  const fetchOnce = async () => {
    try {
      const list = await ipc.listStartableProviders();
      set({ providers: list, loaded: true });
    } catch {
      // web 环境 404 或异常：视为「无可用 CLI」，控件将禁用并提示
      set({ providers: [], loaded: true });
    } finally {
      inflight = null;
    }
  };

  return {
    providers: [],
    loaded: false,

    ensureLoaded: () => {
      if (get().loaded) return Promise.resolve();
      if (!inflight) inflight = fetchOnce();
      return inflight;
    },

    refresh: () => {
      if (!inflight) inflight = fetchOnce();
      return inflight;
    },
  };
});
