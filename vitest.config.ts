import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 纯逻辑测试无需 DOM，使用 node 环境
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
