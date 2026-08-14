// agent-run-logs —— 按 taskId 累积 Agent 实时日志（内存，不持久化）。
// 每次发起执行前 reset，delta 事件触发 append，面板订阅此 store 实时渲染。
import { create } from "zustand";

interface AgentLogState {
  /** taskId → 累积日志文本 */
  logs: Record<string, string>;
  /** 追加增量文本到指定 taskId 的日志 */
  append: (taskId: string, chunk: string) => void;
  /** 发起新执行前清空指定 taskId 的旧日志 */
  reset: (taskId: string) => void;
}

export const useAgentLogStore = create<AgentLogState>((set) => ({
  logs: {},
  append: (taskId, chunk) =>
    set((s) => ({ logs: { ...s.logs, [taskId]: (s.logs[taskId] ?? "") + chunk } })),
  reset: (taskId) => set((s) => ({ logs: { ...s.logs, [taskId]: "" } })),
}));
