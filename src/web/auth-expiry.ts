/**
 * web 端配对态 & 认证过期处理。
 *
 * 独立叶子模块（不 import WebApp/ipc/pb），供 ipc.ts、pb.ts、WebApp.tsx、PairScreen.tsx
 * 共用而无循环依赖。真凭证是 httpOnly cookie（JS 不可读）；localStorage 仅存 UI 配对标记。
 */

/** UI 配对标记 key（真凭证是 httpOnly cookie，此处仅决定渲染 PairScreen 还是主界面）。 */
export const PAIRED_KEY = "kln_web_paired";

/** 是否已配对（UI 态）。 */
export function isPaired(): boolean {
  try {
    return localStorage.getItem(PAIRED_KEY) === "1";
  } catch {
    return false;
  }
}

/** 标记已配对（配对成功后调用）。 */
export function markPaired(): void {
  try {
    localStorage.setItem(PAIRED_KEY, "1");
  } catch {
    /* ignore：隐私模式等 localStorage 不可用时不阻断 */
  }
}

/** 清除配对标记。 */
export function clearPaired(): void {
  try {
    localStorage.removeItem(PAIRED_KEY);
  } catch {
    /* ignore */
  }
}

// 防止并发多个 401 触发多次 reload：一旦进入过期处理即置位。
let handling = false;

/**
 * 认证过期处理：受保护请求收到 401 时调用 —— 清配对标记并刷新页面回到配对页。
 *
 * 场景：程序重启后，若服务端设备表已不含该 token（被吊销，或极端情况持久化文件丢失），
 * 浏览器旧 cookie 会 401。此处引导用户重新配对，而非把「已配对」态卡死在「加载失败」。
 * 正常情况下（设备已持久化 + gateway 已自动重启）token 仍有效、不会走到这里。
 */
export function handleAuthExpired(): void {
  if (handling) return; // 幂等：并发 401 只处理一次，避免多次 reload
  handling = true;
  clearPaired();
  // reload 后 isPaired() 为 false → WebApp 渲染 PairScreen 重新配对。
  window.location.reload();
}
