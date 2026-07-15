import { create } from "zustand";
import { initPbAuth } from "../lib/pb";
type S = { ready: boolean; error?: string; init: () => Promise<void> };
export const useAuthStore = create<S>((set) => ({
  ready: false,
  init: async () => {
    try { await initPbAuth(); set({ ready: true }); }
    catch (e) { set({ error: String(e) }); }
  },
}));
