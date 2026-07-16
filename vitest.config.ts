import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  // 与 vite.config.ts 保持一致的 @ -> ./src 别名，
  // 否则 import 了 "@/..." 的模块在测试里会报 "Cannot find package"。
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // 纯逻辑测试无需 DOM，使用 node 环境
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
