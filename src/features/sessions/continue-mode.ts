// 会话续聊模式偏好（本机 localStorage，默认应用内）。
// - inapp（应用内续聊）：在 rework 里把历史当上下文重放给 claude/codex(-p)，快、不离开应用，
//   但是 rework 侧分叉，**不写回原 CLI 会话文件**。
// - terminal（终端续接）：用 claude/codex --resume 在终端真正接着原会话，写回磁盘、真同步。
const KEY = "keelson-continue-mode";

export type ContinueMode = "inapp" | "terminal";

export function getContinueMode(): ContinueMode {
  try {
    return localStorage.getItem(KEY) === "terminal" ? "terminal" : "inapp";
  } catch {
    return "inapp";
  }
}

export function setContinueMode(m: ContinueMode): void {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* 忽略写入失败 */
  }
}
