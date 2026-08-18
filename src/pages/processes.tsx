// 全局「运行时」页（侧边栏 → 系统）：本地机器资源、agent 容量与托管进程管理。
// 顶部展示 RuntimeStatusCard（机器资源/agent 容量/磁盘）；下方复用 WorkspaceProcesses 全局模式（不传 repoPath）。
// 路由保持 /processes 不变，仅正名展示层。
import { useTranslation } from "react-i18next";
import { WorkspaceProcesses } from "@/features/board/WorkspaceProcesses";
import { RuntimeStatusCard } from "@/features/runtime/RuntimeStatusCard";

export default function ProcessesPage() {
  const { t } = useTranslation("shell");
  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      {/* 页标题：从「进程」正名为「运行时」 */}
      <div className="mb-3 shrink-0">
        <h1 className="text-lg font-semibold">{t("runtime.title")}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("runtime.description")}</p>
      </div>
      {/* 运行时状态卡：机器资源 / agent 容量 / 磁盘 */}
      <RuntimeStatusCard />
      {/* 托管进程区块标题 */}
      <div className="mb-2 shrink-0">
        <h2 className="text-sm font-medium text-muted-foreground">{t("runtime.managedProcesses")}</h2>
      </div>
      <div className="min-h-0 flex-1">
        {/* 不传 repoPath = 全局模式，显示所有托管进程 */}
        <WorkspaceProcesses />
      </div>
    </div>
  );
}
