// BoardListView —— 列表视图：同一 useBoardStore 数据，按状态分组渲染；行点击开 TaskSheet 编辑。
// 与 KanbanBoard 并列由 BoardSurface 二选一渲染；不含拖拽/搜索/批量（P1 精简，YAGNI）。
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBoardStore } from "@/store/board";
import type { BoardTask } from "@/types/board";
import { orderedTaskGroups } from "./list-grouping";
import { PRIORITY_META } from "./board-meta";
import { TaskSheet } from "./TaskSheet";
import { cn } from "@/lib/utils";

export function BoardListView() {
  const { t } = useTranslation("board");
  const states = useBoardStore((s) => s.states);
  const tasks = useBoardStore((s) => s.tasks);
  const labels = useBoardStore((s) => s.labels);
  // 编辑面板受控态
  const [editing, setEditing] = useState<BoardTask | null>(null);

  const groups = useMemo(() => orderedTaskGroups(tasks, states), [tasks, states]);
  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-4">
      {groups.map(({ state, tasks: rows }) => (
        <section key={state.id}>
          {/* 分组头：状态名 + 计数 */}
          <div className="mb-1 flex items-center gap-2 px-1 text-xs font-semibold text-muted-foreground">
            <span className="size-2 rounded-full" style={{ backgroundColor: state.color }} />
            <span>{state.name}</span>
            <span className="tabular-nums">{rows.length}</span>
          </div>
          {rows.length === 0 ? (
            <p className="px-1 py-1 text-xs text-muted-foreground/60">{t("list.emptyGroup")}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {rows.map((task) => (
                <li
                  key={task.id}
                  onClick={() => setEditing(task)}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent/50"
                >
                  {/* 优先级点（none 不显示，避免无意义噪点） */}
                  {task.priority !== "none" && (
                    <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_META[task.priority].dot)} />
                  )}
                  {/* 标题 */}
                  <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
                  {/* 标签色点 */}
                  <span className="flex shrink-0 items-center gap-1">
                    {(task.labels ?? []).map((lid) => {
                      const l = labelById.get(lid);
                      return l ? (
                        <span
                          key={lid}
                          className="size-2 rounded-full"
                          style={{ backgroundColor: l.color }}
                          title={l.name}
                        />
                      ) : null;
                    })}
                  </span>
                  {/* 截止日（取前 10 位，仅日期不含时刻） */}
                  {task.due_date && (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {task.due_date.slice(0, 10)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {/* 尚无状态列时的占位提示 */}
      {states.length === 0 && (
        <div className="flex min-h-48 flex-1 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
          {t("board.noStates")}
        </div>
      )}

      {/* 编辑面板（复用 TaskSheet） */}
      <TaskSheet
        open={editing !== null}
        mode="edit"
        task={editing ?? undefined}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
