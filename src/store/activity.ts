// 实时活动流 store —— 后端 emit("activity") 事件的内存环形缓冲（重启即清）。
// 只做实时呈现；持久历史由 PB activities（listActivities）单独加载。
import { create } from "zustand";
import type { ActivityEvent } from "../types/activity";

/** 内存流上限：避免长会话内存膨胀（spec 约束）。 */
export const ACTIVITY_MAX = 200;

interface ActivityState {
  /** 最近事件（头部最新，最多 ACTIVITY_MAX 条）。 */
  events: ActivityEvent[];
  /** 最近一次 push 的时间戳（毫秒）——用于触发顶栏脉冲动画。 */
  pulse: number;
  /** 头插一条事件（超上限则截断尾部）。 */
  push: (ev: ActivityEvent) => void;
  /** 清空内存流。 */
  clear: () => void;
}

export const useActivityStore = create<ActivityState>((set) => ({
  events: [],
  pulse: 0,

  push: (ev) =>
    set((s) => ({
      // 头插 + 尾部截断到上限
      events: [ev, ...s.events].slice(0, ACTIVITY_MAX),
      pulse: Date.now(),
    })),

  clear: () => set({ events: [], pulse: 0 }),
}));
