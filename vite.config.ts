import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

// Tauri 期望固定端口，且需暴露给 webview
const host = process.env.TAURI_DEV_HOST;

// 应用版本号：从 package.json 读取，注入为编译期常量 __APP_VERSION__（供 web 端「关于」展示，
// 不把整个 package.json 打进前端包）。
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf-8"),
) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // 路径别名 @ -> ./src（对齐 workavera 组件的导入约定）
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
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
    // 本地 web 开发热更：把网关后端端点代理到运行中的 Keelson 网关(固定端口 47700)。
    // 用法：pnpm tauri dev 起应用 → 设置里开「Web 网关」→ 浏览器开 http://localhost:1420，
    // 即得完整 web 端(含 HMR 热更)，/pb /pair /api /ws /healthz 走网关。
    // 注：仅本地开发用；iOS/隧道真机验证仍走网关(pnpm build 后 serve dist)，vite HMR 不经隧道。
    proxy: {
      "/pb": { target: "http://localhost:47700", changeOrigin: true },
      "/pair": { target: "http://localhost:47700", changeOrigin: true },
      "/api": { target: "http://localhost:47700", changeOrigin: true },
      "/healthz": { target: "http://localhost:47700", changeOrigin: true },
      // WebSocket 终端：ws 代理，供本地热更下也能连终端。
      "/ws": { target: "ws://localhost:47700", ws: true, changeOrigin: true },
    },
  },
});
