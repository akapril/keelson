// i18next 初始化：glob 自动装载 locales/<lng>/<ns>.json（加新命名空间只需加文件）。
// 语言变更（含首次）经 Tauri command set_locale 同步给 Rust 侧（托盘/通知）。
import i18n, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { invoke } from "@tauri-apps/api/core";

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
    defaultNS: "common",
    // 取所有语言键的并集，避免某命名空间仅在部分语言中存在时漏注册
    ns: [...new Set(Object.values(resources).flatMap((r) => Object.keys(r)))],
    detection: { order: ["localStorage", "navigator"], caches: ["localStorage"] },
    interpolation: { escapeValue: false }, // React 已防 XSS
  })
  .then(() => {
    // 首次启动同步当前语言给 Rust（非 Tauri 环境静默失败）
    void invoke("set_locale", { locale: i18n.language }).catch(() => {});
  });

// 后续切换同步
i18n.on("languageChanged", (lng) => {
  void invoke("set_locale", { locale: lng }).catch(() => {});
});

export default i18n;
