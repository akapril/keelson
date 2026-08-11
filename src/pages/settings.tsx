// 设置页：仅做区块组合与 store 加载。各设置区已拆到 features/settings/*，
// 主体不再持有各区状态、也不再全量订阅 settings store（只取 error + load）。
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useSettingsStore } from "@/store/settings";
import { ExportSection } from "@/features/export/ExportSection";
import { UpdateSection } from "@/features/updater/UpdateSection";
import { BackendSection } from "@/features/backend/BackendSection";
import { LanguageSection } from "@/features/settings/LanguageSection";
import { ShortcutSection } from "@/features/settings/ShortcutSection";
import { WorkspacePathSection } from "@/features/settings/WorkspacePathSection";
import { ProjectDefaultTabSection } from "@/features/settings/ProjectDefaultTabSection";
import { ProcessExitSection } from "@/features/settings/ProcessExitSection";
import { SystemDataSection } from "@/features/settings/SystemDataSection";
import { AutoArchiveSection } from "@/features/settings/AutoArchiveSection";
import { AiSection } from "@/features/settings/AiSection";
import { EmbedSection } from "@/features/settings/EmbedSection";
import { McpSection } from "@/features/settings/McpSection";
import { ClaudeIntegrationSection } from "@/features/settings/ClaudeIntegrationSection";
import { AutoSyncTasksSection } from "@/features/settings/AutoSyncTasksSection";
import { NotifyPrefsSection } from "@/features/settings/NotifyPrefsSection";
import { WebGatewaySection } from "@/features/settings/WebGatewaySection";

/** 分隔线（各设置区之间）。 */
function Divider() {
  return <div className="border-t border-border" />;
}

/**
 * 设置页面。各区块拆分见 features/settings/*：
 * 快捷键 / 工作区 / 项目默认 tab / 自动归档 / AI / 检索嵌入 / MCP / Claude 集成 /
 * 自动同步 / 通知偏好 / 导出 / 更新 / 后端。
 * 颜色全部使用 Tailwind 语义类（无硬编码 hex/rgba），自动适配明暗主题。
 */
export default function Settings() {
  const { t } = useTranslation("settings");
  // 主体只取 error（顶部错误提示）与 load（挂载加载）；各区各自订阅所需 slice。
  const error = useSettingsStore((s) => s.error);
  const load = useSettingsStore((s) => s.load);
  // 深链定位：?section=<id>（如首页「去接入」跳 ?section=mcp）→ 滚动到该区块。
  // HashRouter 下用 query 参而非 #锚点（#会和路由 hash 冲突）。
  const [params] = useSearchParams();

  // 挂载时从后端加载设置
  useEffect(() => {
    load();
  }, [load]);

  // 有 ?section= 时滚动定位到对应区块（延一帧待各区渲染完）
  useEffect(() => {
    const section = params.get("section");
    if (!section) return;
    const id = window.requestAnimationFrame(() => {
      document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [params]);

  return (
    <div className="mx-auto max-w-xl space-y-8 px-6 py-6">
      {/* 标题 + 当前版本号（版本经 vite define __APP_VERSION__ 注入，见 vite.config） */}
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("page.title")}</h1>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          Keelson v{__APP_VERSION__}
        </span>
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <LanguageSection />
      <Divider />
      <ShortcutSection />
      <Divider />
      <WorkspacePathSection />
      <Divider />
      <ProjectDefaultTabSection />
      <Divider />
      <ProcessExitSection />
      <Divider />
      <SystemDataSection />
      <Divider />
      <AutoArchiveSection />
      <Divider />
      <AiSection />
      <Divider />
      <EmbedSection />
      <Divider />
      {/* id=mcp：供首页「去接入」深链滚动定位；scroll-mt 留出顶栏偏移 */}
      <div id="mcp" className="scroll-mt-6">
        <McpSection />
      </div>
      <Divider />
      <ClaudeIntegrationSection />
      <Divider />
      <AutoSyncTasksSection />
      <Divider />
      <NotifyPrefsSection />
      <Divider />
      <WebGatewaySection />
      <Divider />
      <ExportSection />
      <Divider />
      <UpdateSection />
      <Divider />
      <BackendSection />
    </div>
  );
}
