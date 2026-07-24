// runtime-daemon —— 进程管理 daemon 的前端兜底触发。
// daemon 已融入 rework 进程内（Rust setup 启动时恒定拉起 headless daemon），
// 此处仅作兜底：App 挂载时确认一次，若 Rust 侧因端口等原因没起来则补触发。
import { ipc } from "@/lib/tauri/ipc";

// 模块级一次性守卫：一个 App 生命周期内只触发一次，避免重复。
let ensuredOnce = false;

/**
 * App 启动时确认一次 daemon 在跑（fire-and-forget，静默）。
 * ensure 幂等：已运行直接返回，未运行则在进程内补起。失败也不打扰启动流程。
 */
export function autoStartRuntimeOnce(): void {
  if (ensuredOnce) return;
  ensuredOnce = true;
  void ipc.runtimeEnsureDaemon().catch(() => {});
}
