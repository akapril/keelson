// 设置页：左侧分类导航 + 右侧该分类的设置区。各设置区已拆到 features/settings/*，
// 主体只做分类编排与 store 加载（只取 error + load，各区各自订阅所需 slice）。
import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
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

/** 分隔线（同分类内各区之间）。 */
function Divider() {
  return <div className="border-t border-border" />;
}

/**
 * 设置页面。区块拆分见 features/settings/*，按 4 个分类编排：
 * 通用 / AI 与集成 / 数据与远程 / 系统。
 * 每个 section 带稳定 id，供 ?section=<id> 深链定位（先切到所属分类再滚动）。
 * 颜色全部使用 Tailwind 语义类（无硬编码 hex/rgba），自动适配明暗主题。
 */
export default function Settings() {
  const { t } = useTranslation("settings");
  const error = useSettingsStore((s) => s.error);
  const load = useSettingsStore((s) => s.load);
  const [params] = useSearchParams();
  const [active, setActive] = useState(0);

  // 分类编排：id 用于导航高亮，section.id 用于深链定位。仅渲染当前分类的区块（其余惰性挂载）。
  const categories = useMemo(
    () => [
      {
        id: "general",
        label: t("categories.general"),
        sections: [
          { id: "language", el: <LanguageSection /> },
          { id: "shortcut", el: <ShortcutSection /> },
          { id: "projectDefaultTab", el: <ProjectDefaultTabSection /> },
          { id: "notify", el: <NotifyPrefsSection /> },
        ],
      },
      {
        id: "ai",
        label: t("categories.ai"),
        sections: [
          { id: "ai", el: <AiSection /> },
          { id: "embed", el: <EmbedSection /> },
          { id: "mcp", el: <McpSection /> },
          { id: "claudeIntegration", el: <ClaudeIntegrationSection /> },
          { id: "autoSyncTasks", el: <AutoSyncTasksSection /> },
        ],
      },
      {
        id: "data",
        label: t("categories.data"),
        sections: [
          { id: "workspacePath", el: <WorkspacePathSection /> },
          { id: "autoArchive", el: <AutoArchiveSection /> },
          { id: "backend", el: <BackendSection /> },
          { id: "webGateway", el: <WebGatewaySection /> },
          { id: "export", el: <ExportSection /> },
        ],
      },
      {
        id: "system",
        label: t("categories.system"),
        sections: [
          { id: "systemData", el: <SystemDataSection /> },
          { id: "processExit", el: <ProcessExitSection /> },
          { id: "updater", el: <UpdateSection /> },
        ],
      },
    ],
    [t],
  );

  // 挂载时从后端加载设置
  useEffect(() => {
    load();
  }, [load]);

  // 深链 ?section=<id>：切到该 section 所属分类，再滚动定位（延一帧待渲染）
  useEffect(() => {
    const section = params.get("section");
    if (!section) return;
    const catIdx = categories.findIndex((c) => c.sections.some((s) => s.id === section));
    if (catIdx < 0) return;
    setActive(catIdx);
    const raf = window.requestAnimationFrame(() => {
      document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [params, categories]);

  const current = categories[active] ?? categories[0];

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-6">
      {/* 标题 + 当前版本号（版本经 vite define __APP_VERSION__ 注入，见 vite.config） */}
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("page.title")}</h1>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          Keelson v{__APP_VERSION__}
        </span>
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          role="alert"
          className="mb-6 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="flex gap-8">
        {/* 左：分类导航（黏顶，窄页宽下也不换行） */}
        <nav className="sticky top-6 flex w-36 shrink-0 flex-col gap-0.5 self-start">
          {categories.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                "rounded-md px-3 py-2 text-left text-sm transition-colors",
                i === active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </nav>

        {/* 右：当前分类的设置区 */}
        <div className="min-w-0 flex-1 space-y-8">
          {current.sections.map((s, idx) => (
            <Fragment key={s.id}>
              {idx > 0 && <Divider />}
              <div id={s.id} className="scroll-mt-6">
                {s.el}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
