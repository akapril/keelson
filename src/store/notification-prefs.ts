// 通知类型偏好 store —— 控制哪些来源(source)的通知会被创建/显示。
// 持久化到 localStorage(key: rework-notif-prefs)，默认全部启用，
// 未知 source 也默认 true（向后兼容）。
import { create } from "zustand";

// ─────────────────────────────────────────────
// 已知通知类型
// ─────────────────────────────────────────────

/**
 * 已知通知来源定义（source 值 + 用户可读 label）。
 * ⚠️ source 值不得含 `.`（i18next 将 `.` 作路径分隔符，含 `.` 会静默断裂 i18n 查询）。
 */
export const NOTIF_TYPES: { source: string; label: string }[] = [
  { source: "沉淀",     label: "沉淀（AI 提炼结果）" },
  { source: "截止提醒", label: "截止提醒（任务/事件到期）" },
  { source: "会话",     label: "会话（发现新 CLI 会话）" },
  { source: "更新",     label: "更新（应用新版本）" },
  { source: "MCP",      label: "MCP（外部 Agent 动作）" },
  { source: "Loop",     label: "Loop（收件箱循环任务）" },
];

// 默认值：全部启用
const DEFAULT_PREFS: Record<string, boolean> = Object.fromEntries(
  NOTIF_TYPES.map(({ source }) => [source, true]),
);

const STORAGE_KEY = "keelson-notif-prefs";

// ─────────────────────────────────────────────
// 持久化工具
// ─────────────────────────────────────────────

function loadPrefs(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    // 合并默认值，避免新类型缺失
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(prefs: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* 忽略隐私模式等写入失败 */
  }
}

// ─────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────

interface NotifPrefsState {
  /** source → 是否启用 */
  prefs: Record<string, boolean>;
  /** 设置单个来源的开关 */
  setEnabled: (source: string, enabled: boolean) => void;
  /** 重置为全部启用 */
  resetAll: () => void;
}

export const useNotifPrefsStore = create<NotifPrefsState>((set) => ({
  prefs: loadPrefs(),

  setEnabled: (source, enabled) => {
    set((s) => {
      const prefs = { ...s.prefs, [source]: enabled };
      savePrefs(prefs);
      return { prefs };
    });
  },

  resetAll: () => {
    const prefs = { ...DEFAULT_PREFS };
    savePrefs(prefs);
    set({ prefs });
  },
}));

// ─────────────────────────────────────────────
// 便捷读取（同步，供非组件上下文调用）
// ─────────────────────────────────────────────

/**
 * 判断某个 source 类型是否允许通知。
 * - 已知 source 按偏好；未知 source 默认 true（向后兼容）。
 * 同步读 store 快照，可在任何地方安全调用。
 */
export function isTypeEnabled(source: string): boolean {
  const prefs = useNotifPrefsStore.getState().prefs;
  if (Object.prototype.hasOwnProperty.call(prefs, source)) {
    return prefs[source];
  }
  // 未知来源默认启用
  return true;
}
