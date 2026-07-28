import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import "./i18n"; // 初始化 i18next（须在 App 渲染前）

// 禁用 webview 默认右键菜单（桌面应用观感）；输入框/可编辑元素除外以保留复制粘贴，
// Radix 自定义右键菜单在合成事件阶段先处理并已打开，不受此影响。
window.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement | null;
  if (el?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
