// Docs Zustand Store —— 文档列表状态管理 + CRUD（乐观更新 + 回滚）。
// 数据访问统一走 src/lib/pb/docs.ts，本文件不直接调用 pb.collection。
import { create } from "zustand";
import {
  listDocs,
  createDocRecord,
  updateDocRecord,
  deleteDocRecord,
  subscribeDocs,
} from "../lib/pb/docs";
import { currentUserId } from "../lib/pb";
import type { BoardDoc } from "../types/docs";

// ── 实时订阅的退订句柄（模块级，仅保留当前打开项目的订阅） ──
let unsub: (() => void) | null = null;

/** upsert：按 id 替换，不存在则前插（使实时 echo 幂等，收敛乐观更新） */
function upsertById(list: BoardDoc[], rec: BoardDoc): BoardDoc[] {
  const idx = list.findIndex((x) => x.id === rec.id);
  if (idx === -1) return [rec, ...list];
  const next = list.slice();
  next[idx] = rec;
  return next;
}

/** remove：按 id 过滤移除 */
function removeById(list: BoardDoc[], id: string): BoardDoc[] {
  return list.filter((x) => x.id !== id);
}

// ── Store 状态类型 ─────────────────────────────────────────
interface DocsStoreState {
  /** 当前项目的文档（按 updated 降序） */
  docs: BoardDoc[];
  /** 数据加载中 */
  loading: boolean;
  /** 最近一次错误信息 */
  error?: string;
  /** 当前打开的项目 ID（null = 未打开） */
  openedProjectId: string | null;

  // ── 动作 ────────────────────────────────────────────────
  /** 打开项目：记录 openedProjectId、加载文档列表并订阅实时变更 */
  loadDocs: (projectId: string) => Promise<void>;
  /** 在当前项目新建文档（content 默认空串，owner = 当前用户）；前插到列表 */
  createDoc: (projectId: string, title: string) => Promise<BoardDoc>;
  /** 更新文档标题 / 内容（乐观更新 + 回滚） */
  updateDoc: (
    id: string,
    patch: Partial<Pick<BoardDoc, "title" | "content">>,
  ) => Promise<void>;
  /** 删除文档（乐观移除 + 回滚） */
  deleteDoc: (id: string) => Promise<void>;
  /** 关闭：取消实时订阅并清空状态 */
  closeDocs: () => void;
}

// ── Store 实现 ─────────────────────────────────────────────
export const useDocsStore = create<DocsStoreState>((set, get) => ({
  docs: [],
  loading: false,
  error: undefined,
  openedProjectId: null,

  // ── 加载文档（列表 + 实时订阅） ─────────────────────────
  loadDocs: async (projectId: string) => {
    // 切换项目前先取消上一个订阅，避免泄漏
    if (unsub) {
      unsub();
      unsub = null;
    }
    set({ loading: true, error: undefined, openedProjectId: projectId });
    try {
      const docs = await listDocs(projectId);
      set({ docs, loading: false });
      // 加载成功后订阅该项目的实时变更；upsert-by-id 使 echo 幂等
      unsub = await subscribeDocs(projectId, (action, rec) =>
        set((s) => ({
          docs:
            action === "delete"
              ? removeById(s.docs, rec.id)
              : upsertById(s.docs, rec),
        })),
      );
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  // ── 新建文档 ─────────────────────────────────────────────
  createDoc: async (projectId: string, title: string) => {
    const created = await createDocRecord({
      owner: currentUserId(),
      project: projectId,
      title,
      content: "", // 内容默认空串
    });
    // 前插到本地文档列表（最近创建在前）
    set((s) => ({ docs: [created, ...s.docs] }));
    return created;
  },

  // ── 更新文档（乐观 + PB 写回） ──────────────────────────
  updateDoc: async (
    id: string,
    patch: Partial<Pick<BoardDoc, "title" | "content">>,
  ) => {
    const { docs } = get();
    // 乐观更新本地状态
    set({
      docs: docs.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    });
    try {
      await updateDocRecord(id, patch as Record<string, unknown>);
    } catch (e) {
      // 回滚
      set({ docs, error: String(e) });
    }
  },

  // ── 删除文档（乐观移除 + 回滚） ─────────────────────────
  deleteDoc: async (id: string) => {
    const { docs } = get();
    // 乐观移除
    set({ docs: docs.filter((d) => d.id !== id) });
    try {
      await deleteDocRecord(id);
    } catch (e) {
      // 回滚
      set({ docs, error: String(e) });
    }
  },

  // ── 关闭（退订 + 清空当前文档数据） ─────────────────────
  closeDocs: () => {
    // 取消实时订阅并释放句柄
    unsub?.();
    unsub = null;
    set({ openedProjectId: null, docs: [], error: undefined });
  },
}));
