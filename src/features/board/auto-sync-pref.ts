// 「自动同步 CLI 任务到看板」偏好（本机 localStorage，默认开）。
// 关掉后 maybeAutoSyncTasks 早退，只保留手动「同步任务」按钮。
const KEY = "keelson-auto-sync-tasks";

/** 是否开启自动同步（默认开：只有显式存 "off" 才关）。 */
export function getAutoSyncTasks(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAutoSyncTasks(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* 忽略写入失败 */
  }
}
