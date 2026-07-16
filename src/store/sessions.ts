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

/**
 * 按 session_id 去重（同一 id 保留 updated_at 最新的一条）。
 * codex 会把同一线程的多个 rollout 记为相同 session_id，扫描后会产生重复条目，
 * 导致 React key 冲突；此处统一去重，保证列表内 id 唯一。
 */
export function dedupeById(sessions: Session[]): Session[] {
  const byId = new Map<string, Session>();
  for (const s of sessions) {
    const prev = byId.get(s.session_id);
    // updated_at 为 RFC3339 字符串，同格式下字典序即时间序
    if (!prev || s.updated_at > prev.updated_at) byId.set(s.session_id, s);
  }
  return Array.from(byId.values());
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
  /**
   * 后端首次全量扫描是否已完成。
   * 用于区分「正在扫描（暂时为空）」与「确实无会话」，避免启动时误显示「暂无会话」。
   */
  scanned: boolean;
  error?: string;
  /** 从 Tauri 后端加载全部会话 */
  load: () => Promise<void>;
  /** 切换列表 / 分组视图 */
  setViewMode: (mode: ViewMode) => void;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  groups: {},
  viewMode: "list",
  loading: false,
  scanned: false,
  error: undefined,

  load: async () => {
    // 首次 load 时注册后端事件监听：修复启动首帧抢在后台扫描完成前取到空列表的问题
    // （后端完成首次扫描 / 文件变化后 emit "sessions-updated" → 自动重载）。
    if (!listening) {
      listening = true;
      void on("sessions-updated", () => {
        // 收到事件 = 后端扫描已完成一轮：标记 scanned 后重载
        useSessionsStore.setState({ scanned: true });
        void useSessionsStore.getState().load();
      }).catch(() => {
        // 非 Tauri 环境（如测试）忽略
      });
    }
    // 仅首次（尚无数据）显示加载态；后台同步/事件触发的重载静默进行，
    // 避免每次同步都把列表闪成「加载中」。
    set({ loading: get().sessions.length === 0, error: undefined });
    try {
      const sessions = dedupeById(await ipc.listSessions());
      set({
        sessions,
        groups: groupByProject(sessions),
        loading: false,
        // 取到非空数据也视为已扫描（覆盖事件早于/晚于首帧的各种时序）
        scanned: get().scanned || sessions.length > 0,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  setViewMode: (viewMode) => set({ viewMode }),
}));
