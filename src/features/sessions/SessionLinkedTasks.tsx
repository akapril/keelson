// SessionLinkedTasks —— 会话↔看板双向跳转（反向）：展示由本会话衍生的看板任务。
// 数据经 listTasksBySession(source_session_id) 反查；点击任务跳到其所在项目看板。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { listTasksBySession } from "@/lib/pb/board";
import { workspaceRecordUrl } from "@/lib/workspace-navigation";
import { PRIORITY_META } from "../board/board-meta";
import type { BoardTask } from "@/types/board";

interface SessionLinkedTasksProps {
  sessionId: string;
  /** 变化时重新拉取（如「建任务」对话框关闭后刷新） */
  refreshKey?: number;
  /** 是否展开详情（受 SessionProvenance 折叠控制） */
  open: boolean;
  /** 上报任务数量（供摘要胶囊显示） */
  onCount: (n: number) => void;
}

/**
 * 会话已衍生的看板任务列表。始终拉取并上报数量；仅 open 时渲染详情。
 * 每项点击 → 跳转到该任务所在项目的看板（/board?open=<project>）。
 */
export function SessionLinkedTasks({ sessionId, refreshKey, open, onCount }: SessionLinkedTasksProps) {
  const { t } = useTranslation("sessions");
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<BoardTask[]>([]);

  useEffect(() => {
    let cancelled = false;
    listTasksBySession(sessionId)
      .then((list) => {
        if (cancelled) return;
        setTasks(list);
        onCount(list.length);
      })
      .catch(() => {
        if (!cancelled) {
          setTasks([]);
          onCount(0);
        }
      });
    return () => {
      cancelled = true;
    };
    // onCount 是父级 setState 包装，排除以免刷新循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, refreshKey]);

  if (!open) return null;
  if (tasks.length === 0) {
    return <p className="mt-2 px-1 text-xs text-muted-foreground">{t("linkedTasks.empty")}</p>;
  }

  return (
    <div className="mt-2">
      <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto pr-1">
        {tasks.map((task) => {
          const priority = PRIORITY_META[task.priority];
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => navigate(workspaceRecordUrl("board", task.project))}
              title={t("linkedTasks.jumpTitle")}
              className="group flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {/* 优先级色点（none 也给个中性点，保持对齐） */}
              <span className={`size-1.5 shrink-0 rounded-full ${priority?.dot ?? "bg-muted-foreground/40"}`} />
              <span className="min-w-0 flex-1 truncate text-foreground group-hover:text-accent-foreground">
                {task.title}
              </span>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                className="size-3.5 shrink-0 opacity-40 transition-opacity group-hover:opacity-100"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
