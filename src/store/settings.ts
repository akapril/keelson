import { create } from "zustand";
import { ipc } from "../lib/tauri/ipc";
import {
  type AiConfig,
  type AiProvider,
  type AiProviderFields,
  DEFAULT_AI_CONFIG,
  defaultFieldsFor,
} from "../types/ai";

// localStorage 中 AI 配置的存储键（结构已升级为「按服务商隔离」）
const AI_CONFIG_STORAGE_KEY = "rework-ai-config";

/**
 * 持久化结构：当前激活的服务商 + 每个服务商各自的字段。
 * 这样切换服务商时各自的 key/model/base_url 互不覆盖。
 */
interface AiConfigPersist {
  provider: AiProvider;
  byProvider: Partial<Record<AiProvider, AiProviderFields>>;
}

/** 读取持久化配置；兼容旧的扁平 AiConfig 格式（自动迁移进对应服务商槽）。 */
function loadAiPersist(): AiConfigPersist {
  const fallback: AiConfigPersist = {
    provider: "openai",
    byProvider: { openai: defaultFieldsFor("openai") },
  };
  try {
    const raw = localStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // 新格式：含 byProvider
    if (parsed && typeof parsed === "object" && "byProvider" in parsed) {
      const p = parsed as unknown as AiConfigPersist;
      return {
        provider: p.provider ?? "openai",
        byProvider: p.byProvider ?? {},
      };
    }
    // 旧格式（扁平 AiConfig）→ 迁移到当前服务商的槽
    const old = { ...DEFAULT_AI_CONFIG, ...(parsed as Partial<AiConfig>) } as AiConfig;
    return {
      provider: old.provider,
      byProvider: {
        [old.provider]: {
          base_url: old.base_url,
          api_key: old.api_key,
          model: old.model,
          cli_path: old.cli_path ?? "",
        },
      },
    };
  } catch {
    // 解析异常时回退默认，避免阻塞应用初始化
    return fallback;
  }
}

/** 写回持久化配置（隐私模式等写入失败时静默忽略）。 */
function persistAi(p: AiConfigPersist): void {
  try {
    localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(p));
  } catch {
    // 忽略 localStorage 写入失败
  }
}

/** 由持久化结构派生出当前激活服务商的扁平 AiConfig（消费方仍拿到扁平配置）。 */
function deriveAiConfig(p: AiConfigPersist): AiConfig {
  const f = p.byProvider[p.provider] ?? defaultFieldsFor(p.provider);
  return {
    provider: p.provider,
    base_url: f.base_url ?? "",
    api_key: f.api_key ?? "",
    model: f.model ?? "",
    cli_path: f.cli_path ?? "",
  };
}

// 模块级持久化状态：随 setAiConfig 更新并写回 localStorage
let aiPersist: AiConfigPersist = loadAiPersist();

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

export const useSettingsStore = create<SettingsState>((set) => ({
  hotkey: "",
  workspacePath: "",
  aiConfig: deriveAiConfig(aiPersist),
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
    // 切换服务商：换激活项，并确保目标槽存在（缺省则用官方默认预填）；
    // 关键点——不改动其他服务商的槽，保证各自配置互不覆盖。
    if (patch.provider && patch.provider !== aiPersist.provider) {
      const target = patch.provider;
      aiPersist = {
        provider: target,
        byProvider: {
          ...aiPersist.byProvider,
          [target]: aiPersist.byProvider[target] ?? defaultFieldsFor(target),
        },
      };
    } else {
      // 同一服务商内改字段：只写当前服务商的槽
      const cur = aiPersist.byProvider[aiPersist.provider] ?? defaultFieldsFor(aiPersist.provider);
      const merged: AiProviderFields = {
        base_url: patch.base_url ?? cur.base_url,
        api_key: patch.api_key ?? cur.api_key,
        model: patch.model ?? cur.model,
        cli_path: patch.cli_path ?? cur.cli_path,
      };
      aiPersist = {
        provider: aiPersist.provider,
        byProvider: { ...aiPersist.byProvider, [aiPersist.provider]: merged },
      };
    }
    persistAi(aiPersist);
    set({ aiConfig: deriveAiConfig(aiPersist) });
  },
}));
