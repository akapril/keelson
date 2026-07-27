// 全局「进程」页（侧边栏 → 系统）：rework 托管的全部进程（跨项目）一览与管理。
// 复用 WorkspaceProcesses 的全局模式（不传 repoPath）：显示所有进程 + 日志 + 停止/重启/删除 + 清理。
// 启动新进程仍归具体项目的「进程」标签（那里知道 cwd）。
import { useTranslation } from "react-i18next";
import { WorkspaceProcesses } from "@/features/board/WorkspaceProcesses";

export default function ProcessesPage() {
  const { t } = useTranslation("shell");
  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      <div className="mb-3 shrink-0">
        <h1 className="text-lg font-semibold">{t("processes.title")}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("processes.description")}
        </p>
      </div>
      <div className="min-h-0 flex-1">
        {/* 不传 repoPath = 全局模式 */}
        <WorkspaceProcesses />
      </div>
    </div>
  );
}
