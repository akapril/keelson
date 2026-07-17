// 系统桌面通知(tauri-plugin-notification)薄封装:首次自动申请权限,失败静默。
// 用于"后台/未聚焦时也该知道"的事件(应用更新、MCP 外部操作由 Rust 端直接弹)。
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

/** 发一条系统通知;无权限则请求;非 tauri 环境或被拒则静默忽略。 */
export async function osNotify(title: string, body: string): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  } catch {
    /* 非 tauri 环境 / 权限被拒:忽略 */
  }
}
