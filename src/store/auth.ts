import { create } from "zustand";
import {
  initPbAuth,
  pbAuthUser,
  pbIsAuthed,
  pbLogin,
  pbRegister,
  pbLogout,
  type PbUser,
} from "../lib/pb";

type S = {
  /** bootstrap 是否完成（PB 就绪 + 默认认证尝试） */
  ready: boolean;
  /** 当前是否已认证 */
  authed: boolean;
  /** 当前用户展示信息 */
  user: PbUser | null;
  error?: string;
  init: () => Promise<void>;
  login: (identity: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
};

export const useAuthStore = create<S>((set) => ({
  ready: false,
  authed: false,
  user: null,
  init: async () => {
    try {
      await initPbAuth();
      // 默认免登录：bootstrap 已落 token → authed=true；多用户可再登出/切换
      set({ ready: true, authed: pbIsAuthed(), user: pbAuthUser() });
    } catch (e) {
      set({ error: String(e), ready: false });
    }
  },
  login: async (identity, password) => {
    await pbLogin(identity, password);
    set({ authed: true, user: pbAuthUser(), error: undefined });
  },
  register: async (email, password, name) => {
    await pbRegister(email, password, name);
    set({ authed: true, user: pbAuthUser(), error: undefined });
  },
  logout: () => {
    pbLogout();
    set({ authed: false, user: null });
  },
}));
