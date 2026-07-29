/// <reference types="vite/client" />

// 编译期注入的应用版本号（见 vite.config.ts 的 define），供 web 端「关于」展示。
declare const __APP_VERSION__: string;
