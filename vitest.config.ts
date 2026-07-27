import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // 与 vite.config.ts 保持一致的 @ -> ./src 别名，
  // 否则 import 了 "@/..." 的模块在测试里会报 "Cannot find package"。
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // 纯逻辑测试无需 DOM，使用 node 环境
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // TSX 组件测试通过文件头 @vitest-environment jsdom 指定环境
  },
});
