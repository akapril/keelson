import { create } from "zustand";
import { ipc } from "../lib/tauri/ipc";
import { type AiConfig, DEFAULT_AI_CONFIG } from "../types/ai";

// localStorage 中 AI 配置的存储键
const AI_CONFIG_STORAGE_KEY = "rework-ai-config";

/**
 * 从 localStorage 读取 AI 配置；解析失败或缺省时回退到 DEFAULT_AI_CONFIG。
 * 与 DEFAULT_AI_CONFIG 做浅合并，保证新增字段有默认值。
 */
function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_AI_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AiConfig>;
    return { ...DEFAULT_AI_CONFIG, ...parsed };
  } catch {
    // JSON 解析异常时回退默认配置，避免阻塞应用初始化
    return DEFAULT_AI_CONFIG;
  }
}

// ── Store 状态类型 ─────────────────────────────────────────
interface SettingsState {
  /** 全局唤起快捷键（如 "CmdOrCtrl+Shift+Space"） */
  hotkey: string;
  /** 工作区路径（本地状态，暂不持久化到后端） */
  workspacePath: string;
  /** AI 助手配置（仅本机 localStorage 持久化，含密钥） */
  aiConfig: AiConfig;
  loading: boolean;
  error?: string;
  /** 从 Tauri 后端加载设置 */
  load: () => Promise<void>;
  /** 保存快捷键到 Tauri 后端 */
  saveHotkey: (h: string) => Promise<void>;
  /** 局部更新 AI 配置并持久化到 localStorage */
  setAiConfig: (patch: Partial<AiConfig>) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  hotkey: "",
  workspacePath: "",
  aiConfig: loadAiConfig(),
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

  setAiConfig: (patch: Partial<AiConfig>) => {
    // 合并当前配置与补丁，更新 store 并同步持久化到 localStorage
    const next: AiConfig = { ...get().aiConfig, ...patch };
    set({ aiConfig: next });
    try {
      localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage 写入失败（如隐私模式）时静默忽略，不影响内存状态
    }
  },
}));
