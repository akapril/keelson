/**
 * 环境检测工具
 * isTauri: 检测当前是否运行在 Tauri 原生 webview 中。
 * 依据：Tauri 初始化时在 window 上注入 __TAURI_INTERNALS__ 对象。
 */
export function isTauri(): boolean {
  return typeof (window as any).__TAURI_INTERNALS__ !== "undefined";
}
