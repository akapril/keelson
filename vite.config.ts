import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri 期望固定端口，且需暴露给 webview
// @ts-expect-error process 是 Node.js 全局变量
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 防止 Vite 遮蔽 Rust 错误信息
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 不监听 src-tauri 目录，避免无效热重载
      ignored: ["**/src-tauri/**"],
    },
  },
});
