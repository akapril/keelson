import PocketBase from "pocketbase";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/env";
import { handleAuthExpired } from "@/web/auth-expiry";
// 组件禁止直接 import 本文件的 pb 之外的东西；数据访问走 lib/pb/collections.ts
export const pb = new PocketBase("http://127.0.0.1:0"); // 占位，init 时覆盖 baseURL
// 桌面应用无需浏览器式的请求自动取消；关闭它，避免 StrictMode 双跑 effect /
// 并发加载时同 key 请求被取消而抛出 "The request was aborted (autocancelled)"。
pb.autoCancellation(false);

type BootstrapAuth = { baseUrl: string; token: string; userId: string };

// ── 远程 PB（多设备）：设置里配置远程 URL 后，前端指向远程并走真实登录 ──
const REMOTE_URL_KEY = "rework-remote-pb-url";

/** 读取配置的远程 PB URL（空串=用本地内置 sidecar）。 */
export function getRemotePbUrl(): string {
  try {
    return (localStorage.getItem(REMOTE_URL_KEY) || "").trim();
  } catch {
    return "";
  }
}

/** 设置/清空远程 PB URL（清空=回到本地）。修改后需重载应用生效。 */
export function setRemotePbUrl(url: string): void {
  try {
    const v = url.trim();
    if (v) localStorage.setItem(REMOTE_URL_KEY, v);
    else localStorage.removeItem(REMOTE_URL_KEY);
  } catch {
    /* ignore */
  }
}

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
  const remote = getRemotePbUrl();

  // 远程模式：指向远程 PB，不自动登录；有已保存会话则刷新，否则由 LoginScreen 处理。
  if (remote) {
    pb.baseURL = remote;
    if (pb.authStore.isValid) {
      try {
        await pb.collection("users").authRefresh();
      } catch {
        // 保存的 token 对远程无效（如来自本地）：清空 → 登录界面
        pb.authStore.clear();
      }
    }
    return;
  }

  // Web 环境（非 Tauri、非远程）：baseURL 指向 gateway /pb 反代；
  // 从 /api/bootstrap_auth 取 PB token（受 kln_token cookie 闸保护）。
  // ⚠️ 此分支绝不调 invoke——web 环境无 Tauri IPC，invoke 会同步抛出致白屏。
  if (!isTauri()) {
    // 经 gateway 同源反代访问 PocketBase（/pb/* → 127.0.0.1:<pb_port>/*）
    pb.baseURL = `${location.origin}/pb`;
    try {
      // 从 gateway /api/bootstrap_auth 获取 PB token 和 userId
      const { token, userId } = await fetch("/api/bootstrap_auth", {
        method: "POST", // 服务端注册为 POST only；缺此则发 GET → 405，web 端永远认证失败
        credentials: "same-origin",
      }).then((r) => {
        // 认证过期（重启后 cookie 对应设备已失效）：引导重新配对，而非静默失败卡加载。
        if (r.status === 401) {
          handleAuthExpired();
          throw new Error("bootstrap_auth 401");
        }
        if (!r.ok) throw new Error(`bootstrap_auth ${r.status}`);
        return r.json() as Promise<{ token: string; userId: string }>;
      });
      // 用 PB token 填充 authStore，免登录（与桌面端行为对称）
      pb.authStore.save(token, { id: userId, collectionName: "users" } as any);
      // 尝试刷新拉取完整用户记录；失败时保留最小 token（web 端常见场景）
      try {
        await pb.collection("users").authRefresh();
      } catch {
        /* 忽略：token 仍可用，仅缺展示字段 */
      }
    } catch (e) {
      // bootstrap_auth 失败（如 cookie 尚未配对）：清空 authStore，由登录界面接手
      pb.authStore.clear();
      console.warn("[pb] web 端 bootstrap_auth 失败，需重新配对:", e);
    }
    return;
  }

  // 本地模式（Tauri 桌面端）：等待内置 sidecar bootstrap，免登录直接落 token。
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
