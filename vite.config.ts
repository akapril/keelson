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
  },
});
