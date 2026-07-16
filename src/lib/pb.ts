import PocketBase from "pocketbase";
import { invoke } from "@tauri-apps/api/core";
// 组件禁止直接 import 本文件的 pb 之外的东西；数据访问走 lib/pb/collections.ts
export const pb = new PocketBase("http://127.0.0.1:0"); // 占位，init 时覆盖 baseURL

type BootstrapAuth = { baseUrl: string; token: string; userId: string };

/**
 * 轮询等待后端 bootstrap 完成。
 *
 * 后端在启动时于后台 tokio 任务里异步执行「启动 PocketBase → 健康检查(最多 15s) →
 * 创建/校验用户」，期间 `get_bootstrap_auth` 会返回「尚未初始化」错误。前端不能只调一次
 * 就放弃（否则必然抢跑、永久卡在错误），而应重试直到就绪或超时。
 */
async function waitForBootstrap(timeoutMs = 30_000, intervalMs = 400): Promise<BootstrapAuth> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  // 首次不延迟，之后每 intervalMs 重试一次
  for (;;) {
    try {
      return await invoke<BootstrapAuth>("get_bootstrap_auth");
    } catch (e) {
      lastErr = e;
      if (Date.now() >= deadline) {
        // 超时仍未就绪：多半是后端 bootstrap 失败（终端会打印 “PocketBase 初始化失败”）
        throw new Error(`PocketBase 初始化超时（${Math.round(timeoutMs / 1000)}s）：${String(lastErr)}`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

export async function initPbAuth(): Promise<void> {
  const a = await waitForBootstrap();
  // v0.27+ 使用 baseURL（非弃用属性），兼容 brief 中的 baseUrl 字段名（来自 Rust）
  pb.baseURL = a.baseUrl;
  // 默认免登录：用 Rust 派发的 token 直接落 authStore（多用户可再登出/切换）
  pb.authStore.save(a.token, { id: a.userId, collectionName: "users" } as any);
  // 刷新以拉取完整用户记录（email / displayName），失败则保留最小记录
  try {
    await pb.collection("users").authRefresh();
  } catch {
    /* 忽略：token 仍可用，仅缺展示字段 */
  }
}

export const currentUserId = () => pb.authStore.record?.id ?? "";

// ── 多用户认证（auth 明面在此文件收口；pb.authStore 属认证管线，非集合数据） ──
export type PbUser = { id: string; email: string; name: string };

/** 从 authStore 读取当前用户展示信息（未认证返回 null）。 */
export function pbAuthUser(): PbUser | null {
  const r = pb.authStore.record;
  if (!r) return null;
  const email = (r.email as string | undefined) ?? "";
  const displayName = (r.displayName as string | undefined) ?? "";
  return { id: r.id, email, name: displayName || email || r.id };
}

/** 当前是否已认证。 */
export const pbIsAuthed = () => pb.authStore.isValid;

/** 账号密码登录（identity 可为 email）。 */
export async function pbLogin(identity: string, password: string): Promise<void> {
  await pb.collection("users").authWithPassword(identity.trim(), password);
}

/** 注册新用户并登录（需 users 集合允许创建；本地场景默认允许）。 */
export async function pbRegister(
  email: string,
  password: string,
  name: string,
): Promise<void> {
  await pb.collection("users").create({
    email: email.trim(),
    password,
    passwordConfirm: password,
    displayName: name.trim(),
  });
  await pb.collection("users").authWithPassword(email.trim(), password);
}

/** 登出：清空 authStore（回到登录界面）。 */
export function pbLogout(): void {
  pb.authStore.clear();
}
