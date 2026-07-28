/**
 * 环境检测工具
 * isTauri: 检测当前是否运行在 Tauri 原生 webview 中。
 * 依据：Tauri 初始化时在 window 上注入 __TAURI_INTERNALS__ 对象。
 */
export function isTauri(): boolean {
  // 先判 window 是否存在：node 测试环境（非 jsdom 的 .test.ts）无 window 全局，
  // 直接访问 window.xxx 会抛 ReferenceError（typeof 只保护标识符本身，不保护属性访问的对象）。
  return (
    typeof window !== "undefined" &&
    typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined"
  );
}
