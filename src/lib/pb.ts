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
  // 单用户免登录：用 Rust 派发的 token 直接落 authStore
  pb.authStore.save(a.token, { id: a.userId, collectionName: "users" } as any);
}
export const currentUserId = () => pb.authStore.record?.id ?? "";
