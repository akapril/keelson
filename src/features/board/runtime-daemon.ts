// runtime-daemon —— claude-runtime daemon 的「随 rework 自动启动」偏好 + 启动触发。
// 纯前端偏好（localStorage，默认开）；App 挂载时按偏好触发一次 ensure_daemon，
// 使「daemon 未运行」基本不再出现。手动「修复」直接调 ipc.runtimeEnsureDaemon。
import { ipc } from "@/lib/tauri/ipc";

const AUTOSTART_KEY = "rework-runtime-autostart";

/** 是否随 rework 自动启动 daemon（缺省 = 开）。 */
export function getAutoStartRuntime(): boolean {
  try {
    // 仅当显式存过 "0" 才关闭，其余（含未设置）默认开。
    return localStorage.getItem(AUTOSTART_KEY) !== "0";
  } catch {
    return true;
  }
}

/** 写回自动启动偏好。 */
export function setAutoStartRuntime(on: boolean): void {
  try {
    localStorage.setItem(AUTOSTART_KEY, on ? "1" : "0");
  } catch {
    // 忽略 localStorage 写入失败（隐私模式）
  }
}

// 模块级一次性守卫：一个 App 生命周期内只触发一次自动启动，避免重复 spawn。
let ensuredOnce = false;

/**
 * App 启动时按偏好触发一次 daemon 自动启动（fire-and-forget，静默）。
 * ensure_daemon 自身幂等（已运行直接返回），故即使误触也安全。
 */
export function autoStartRuntimeOnce(): void {
  if (ensuredOnce) return;
  ensuredOnce = true;
  if (!getAutoStartRuntime()) return;
  // 不 await、不弹 toast：后台静默拉起，失败（如未装二进制）也不打扰启动流程。
  void ipc.runtimeEnsureDaemon().catch(() => {});
}
