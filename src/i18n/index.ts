// i18next 初始化：glob 自动装载 locales/<lng>/<ns>.json（加新命名空间只需加文件）。
// 语言变更（含首次）经 Tauri command set_locale 同步给 Rust 侧（托盘/通知）。
import i18n, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/env";

// 同步当前语言给 Rust 侧（托盘/通知）。web 环境无 Tauri IPC——invoke 会同步访问
// window.__TAURI_INTERNALS__ 抛 TypeError（.catch 捕获不到同步抛），故必须先守卫跳过，
// 否则 web 端启动即白屏（Cannot read properties of undefined reading 'metadata'）。
function syncLocaleToRust(locale: string) {
  if (!isTauri()) return;
  void invoke("set_locale", { locale }).catch(() => {});
}

// 装载全部资源：路径形如 ./locales/zh/common.json
const files = import.meta.glob("./locales/*/*.json", { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;
const resources: Resource = {};
for (const path in files) {
  const m = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!m) continue;
  const [, lng, ns] = m;
  (resources[lng] ??= {})[ns] = files[path].default;
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: ["zh", "en"],
    fallbackLng: "en",
    // 只按基础语言码匹配：中文系统 navigator.language 为 "zh-CN"，不加此项会因不在
    // supportedLngs(["zh","en"]) 内而落到 fallback "en"。languageOnly 把 "zh-CN"→"zh"、
    // "en-US"→"en"，让"跟随系统"对带地区码的系统语言也正确生效。
    load: "languageOnly",
    defaultNS: "common",
    // 取所有语言键的并集，避免某命名空间仅在部分语言中存在时漏注册
    ns: [...new Set(Object.values(resources).flatMap((r) => Object.keys(r)))],
    detection: { order: ["localStorage", "navigator"], caches: ["localStorage"] },
    interpolation: { escapeValue: false }, // React 已防 XSS
  })
  .then(() => {
    // 首次启动同步当前语言给 Rust
    syncLocaleToRust(i18n.language);
  });

// 后续切换同步
i18n.on("languageChanged", (lng) => {
  syncLocaleToRust(lng);
});

export default i18n;
