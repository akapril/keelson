import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./i18n"; // 初始化 i18next（须在 App 渲染前）
import { isTauri } from "./lib/env";

// 桌面端：禁用 webview 默认右键菜单（应用观感）；输入框/可编辑元素除外以保留复制粘贴。
// Radix 自定义右键菜单在合成事件阶段先处理并已打开，不受此影响。
// Web 端无需此限制，保留浏览器默认行为。
if (isTauri()) {
  window.addEventListener("contextmenu", (e) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
    e.preventDefault();
  });
}

// 按环境「动态」加载根组件，彻底隔离两套代码树：
// web 环境不 import 桌面 App 树——App→TitleBar 等在 module 顶层调 getCurrentWindow()，
// 读 __TAURI_INTERNALS__.metadata 会同步抛 TypeError 致 web 白屏；静态 import 会连带执行
// 整棵树的顶层副作用，故必须动态 import 按需加载，让 web 端只加载 WebApp 树。
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
void (async () => {
  if (isTauri()) {
    const { default: App } = await import("./App");
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } else {
    const { WebApp } = await import("./web/WebApp");
    root.render(
      <React.StrictMode>
        <WebApp />
      </React.StrictMode>,
    );
  }
})();
