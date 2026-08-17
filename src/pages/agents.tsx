// Agents 管理页：命名队友的网格展示 + 新建 / 编辑 / 归档 / 删除。
// 挂载时拉取 store；主网格过滤掉已归档的 agent（MVP：隐藏归档）。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { useAgentStore } from "@/store/agents";
import type { AgentProfile } from "@/types/agent-profile";
import { AgentCard } from "@/features/agents/AgentCard";
import { AgentEditSheet } from "@/features/agents/AgentEditSheet";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function AgentsPage() {
  const { t } = useTranslation("board");
  const { agents, loaded, load } = useAgentStore();

  // 控制编辑抽屉：undefined=关闭；null=新建；AgentProfile=编辑
  const [editing, setEditing] = useState<AgentProfile | null | undefined>(undefined);
  // 待删除确认
  const [pendingDelete, setPendingDelete] = useState<AgentProfile | null>(null);

  // 挂载时加载 agents
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  // 过滤掉已归档（MVP：隐藏归档）
  const visible = agents.filter((a) => !a.archived && !a.deleted_at);

  /** 归档 agent */
  const handleArchive = async (agent: AgentProfile) => {
    try {
      await useAgentStore.getState().updateAgent(agent.id, { archived: true });
      toast.success(t("agentsPage.toastArchiveSuccess", { name: agent.name }));
    } catch (e) {
      toast.error(t("agentsPage.toastArchiveError", { msg: String(e) }));
    }
  };

  /** 删除 agent */
  const handleDelete = async (agent: AgentProfile) => {
    try {
      await useAgentStore.getState().removeAgent(agent.id);
      toast.success(t("agentsPage.toastDeleteSuccess", { name: agent.name }));
    } catch (e) {
      toast.error(t("agentsPage.toastDeleteError", { msg: String(e) }));
    }
    setPendingDelete(null);
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col gap-4 p-6">
      {/* 页头：标题 + 新建按钮 */}
      <header className="flex shrink-0 items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{t("agentsPage.title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("agentsPage.description")}
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing(null)}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          {t("agentsPage.newAgent")}
        </Button>
      </header>

      {/* 内容区：加载中 / 空态 / 网格 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!loaded ? (
          // 加载中
          <p className="py-16 text-center text-sm text-muted-foreground">
            {t("agentsPage.loading")}
          </p>
        ) : visible.length === 0 ? (
          // 空态引导
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <p className="text-sm text-muted-foreground">{t("agentsPage.empty")}</p>
            <Button size="sm" onClick={() => setEditing(null)}>
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
              {t("agentsPage.newAgent")}
            </Button>
          </div>
        ) : (
          // 网格展示
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onEdit={setEditing}
                onArchive={handleArchive}
                onDelete={setPendingDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* 编辑 / 新建抽屉 */}
      <AgentEditSheet
        editing={editing ?? undefined}
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
      />

      {/* 删除确认对话框 */}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("agentsPage.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("agentsPage.confirmDeleteDesc", { name: pendingDelete?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("agentsPage.confirmDeleteCancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) void handleDelete(pendingDelete);
              }}
            >
              {t("agentsPage.confirmDeleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
