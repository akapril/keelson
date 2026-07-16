// SessionLinkedTasks —— 会话↔看板双向跳转（反向）：展示由本会话衍生的看板任务。
// 数据经 listTasksBySession(source_session_id) 反查；点击任务跳到其所在项目看板。
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, DashboardSquare02Icon } from "@hugeicons/core-free-icons";

import { listTasksBySession } from "@/lib/pb/board";
import { workspaceRecordUrl } from "@/lib/workspace-navigation";
import { PRIORITY_META } from "../board/board-meta";
import type { BoardTask } from "@/types/board";

interface SessionLinkedTasksProps {
  sessionId: string;
  /** 变化时重新拉取（如「建任务」对话框关闭后刷新） */
  refreshKey?: number;
}

/**
 * 会话已衍生的看板任务列表。
 * - 无任务时不渲染任何内容（避免占位噪声）。
 * - 每项点击 → 跳转到该任务所在项目的看板（/board?open=<project>）。
 */
export function SessionLinkedTasks({ sessionId, refreshKey }: SessionLinkedTasksProps) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<BoardTask[]>([]);

  useEffect(() => {
    let cancelled = false;
    listTasksBySession(sessionId)
      .then((list) => {
        if (!cancelled) setTasks(list);
      })
      .catch(() => {
        // 反查失败不阻断预览；静默留空
        if (!cancelled) setTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  if (tasks.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-border pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <HugeiconsIcon icon={DashboardSquare02Icon} strokeWidth={2} className="size-3.5" />
        关联任务（{tasks.length}）
      </div>
      <div className="flex flex-col gap-1.5">
        {tasks.map((t) => {
          const priority = PRIORITY_META[t.priority];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => navigate(workspaceRecordUrl("board", t.project))}
              title="跳转到该任务所在项目看板"
              className="group flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {/* 优先级色点（none 也给个中性点，保持对齐） */}
              <span className={`size-1.5 shrink-0 rounded-full ${priority?.dot ?? "bg-muted-foreground/40"}`} />
              <span className="min-w-0 flex-1 truncate text-foreground group-hover:text-accent-foreground">
                {t.title}
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
