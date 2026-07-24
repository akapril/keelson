// ESLint flat config（ESLint 10 + typescript-eslint 8）。
// 首次接入：高噪声规则先降为 warn（存量记 backlog，不阻断 CI）；
// react-hooks 规则可抓真实 bug，也先 warn，后续再逐步收紧为 error。
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "src-tauri/**",
      "node_modules/**",
      "scripts/**",
      "**/*.config.{js,ts}",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // react hooks：先 warn（存量记 backlog），稳定后把 rules-of-hooks 提为 error
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
      // 高噪声规则降为 warn，避免首次接入直接 flood
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "no-empty": "warn",
      "prefer-const": "warn",
      // ESLint 10 新核心规则：先 warn（存量记 backlog）
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
    },
  },
);
