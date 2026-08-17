// 命名队友 store：CRUD + 乐观更新（写失败回滚并重抛，供调用点 toast）。
import { create } from "zustand";
import { listAgents, createAgentRecord, updateAgentRecord, softDeleteAgent } from "../lib/pb/agents";
import { currentUserId } from "../lib/pb";
import type { AgentProfile } from "../types/agent-profile";

interface AgentState {
  agents: AgentProfile[];
  loaded: boolean;
  load: () => Promise<void>;
  createAgent: (input: Partial<AgentProfile>) => Promise<AgentProfile>;
  updateAgent: (id: string, patch: Partial<AgentProfile>) => Promise<void>;
  removeAgent: (id: string) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  loaded: false,
  load: async () => {
    const agents = await listAgents();
    set({ agents, loaded: true });
  },
  createAgent: async (input) => {
    const rec = await createAgentRecord({ ...input, owner: currentUserId() });
    set({ agents: [rec, ...get().agents] });
    return rec;
  },
  updateAgent: async (id, patch) => {
    const { agents } = get();
    set({ agents: agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
    try {
      await updateAgentRecord(id, patch as Record<string, unknown>);
    } catch (e) {
      set({ agents }); // 回滚
      throw e;          // 重抛，调用点 toast
    }
  },
  removeAgent: async (id) => {
    const { agents } = get();
    set({ agents: agents.filter((a) => a.id !== id) });
    try {
      await softDeleteAgent(id);
    } catch (e) {
      set({ agents });
      throw e;
    }
  },
}));
