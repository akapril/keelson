// 队友卡片：展示单个命名 agent 的摘要信息（emoji / 名称 / provider 徽标 / 技能数 / 运行时摘要）。
// hover 显示归档和删除按钮（stopPropagation 防触发卡片编辑）；点击卡片触发 onEdit。
import { HugeiconsIcon } from "@hugeicons/react";
import { Archive02Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { PROVIDER_META, providerLabel } from "@/lib/providers";
import type { AgentProfile } from "@/types/agent-profile";

interface Props {
  agent: AgentProfile;
  onEdit: (a: AgentProfile) => void;
  onArchive: (a: AgentProfile) => void;
  onDelete: (a: AgentProfile) => void;
}

export function AgentCard({ agent, onEdit, onArchive, onDelete }: Props) {
  const meta = PROVIDER_META[agent.provider];
  // 技能数 = 绑定指令库技能数 + 自由文本技能（有内容算 1 条）
  const skillCount = (agent.skill_prompts?.length ?? 0) + (agent.skill_text?.trim() ? 1 : 0);

  return (
    <div
      onClick={() => onEdit(agent)}
      className="group relative cursor-pointer rounded-xl border border-border/60 bg-card p-4 shadow-sm transition-all hover:border-border hover:shadow-md"
    >
      {/* 主体：emoji + 名称 + provider 徽标 */}
      <div className="flex items-center gap-3">
        <span className="text-2xl">{agent.emoji || "🤖"}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{agent.name}</p>
          <span className={cn("mt-0.5 inline-flex rounded-md px-1.5 py-0.5 text-[10px]", meta?.chip)}>
            {providerLabel(agent.provider)}
          </span>
        </div>
      </div>

      {/* 运行时摘要：技能数 / 并发上限 / 工具 / 自动提交 */}
      <p className="mt-2 text-xs text-muted-foreground">
        技能 {skillCount} · 并发 {agent.max_concurrent || 1}
        {agent.with_tools === false ? " · 无工具" : ""}
        {agent.auto_commit ? " · 自动提交" : ""}
      </p>

      {/* 操作按钮：hover 才显现，stopPropagation 防触发卡片编辑 */}
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          title="归档"
          onClick={(e) => {
            e.stopPropagation();
            onArchive(agent);
          }}
          className="rounded p-1 hover:bg-muted"
        >
          <HugeiconsIcon icon={Archive02Icon} className="size-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          title="删除"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(agent);
          }}
          className="rounded p-1 text-destructive hover:bg-muted"
        >
          <HugeiconsIcon icon={Delete02Icon} className="size-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
