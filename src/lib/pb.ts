import PocketBase from "pocketbase";
import { invoke } from "@tauri-apps/api/core";
// 组件禁止直接 import 本文件的 pb 之外的东西；数据访问走 lib/pb/collections.ts
export const pb = new PocketBase("http://127.0.0.1:0"); // 占位，init 时覆盖 baseURL

export async function initPbAuth(): Promise<void> {
  const a = await invoke<{ baseUrl: string; token: string; userId: string }>("get_bootstrap_auth");
  // v0.27+ 使用 baseURL（非弃用属性），兼容 brief 中的 baseUrl 字段名（来自 Rust）
  pb.baseURL = a.baseUrl;
  // 单用户免登录：用 Rust 派发的 token 直接落 authStore
  pb.authStore.save(a.token, { id: a.userId, collectionName: "users" } as any);
}
export const currentUserId = () => pb.authStore.record?.id ?? "";
