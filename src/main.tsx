import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { WebApp } from "./web/WebApp";
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

// isTauri: 渲染桌面原生根组件；否则渲染 web 入口（配对页/主体）
const RootComponent = isTauri() ? App : WebApp;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>,
);
