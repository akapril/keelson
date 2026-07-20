// WorkspaceActivity —— 项目工作台「活动」标签：
// 挂载时 listActivities(projectId) 拉持久历史（写操作），叠加内存流里 project_id 命中的实时事件，
// 合并去重（按 id）、按 ts 倒序。持久历史含写操作可回放；实时流含读/写全部动作。
import { useEffect, useMemo, useState } from "react";
import { Virtualizer } from "virtua";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Activity03Icon,
  Edit02Icon,
  BookOpen01Icon,
  TerminalIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { listActivities } from "@/lib/pb/activity";
import { useActivityStore } from "@/store/activity";
import type { ActivityAction, ActivityEvent } from "@/types/activity";

// 动作 → 图标（中性语义，不硬编码颜色）
const ACTION_ICON: Record<ActivityAction, typeof Edit02Icon> = {
  write: Edit02Icon,
  read: BookOpen01Icon,
  run: TerminalIcon,
  search: Search01Icon,
};

// 动作 → 中文标签
const ACTION_LABEL: Record<ActivityAction, string> = {
  write: "写入",
  read: "读取",
  run: "执行",
  search: "检索",
};

function fmtTime(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** 合并持久历史 + 实时流：按 id 去重（实时 echo 幂等），按 ts 倒序。导出以便单测。 */
export function mergeEvents(persisted: ActivityEvent[], live: ActivityEvent[]): ActivityEvent[] {
  const byId = new Map<string, ActivityEvent>();
  // 先放持久（PB id 权威），再放实时；同 id 以后写入为准无妨（内容一致）
  for (const e of persisted) byId.set(e.id, e);
  for (const e of live) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

export function WorkspaceActivity({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [persisted, setPersisted] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  // 内存流中命中本项目的实时事件
  const liveAll = useActivityStore((s) => s.events);
  const live = useMemo(
    () => liveAll.filter((e) => e.project_id === projectId),
    [liveAll, projectId],
  );

  // 挂载 / 项目切换时拉持久历史
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listActivities(projectId)
      .then((items) => {
        if (!cancelled) setPersisted(items);
      })
      .catch(() => {
        if (!cancelled) setPersisted([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const merged = useMemo(() => mergeEvents(persisted, live), [persisted, live]);

  if (loading && merged.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载活动历史…
      </div>
    );
  }

  if (merged.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <HugeiconsIcon icon={Activity03Icon} strokeWidth={1.5} className="size-8 opacity-50" />
        <span className="text-sm">暂无活动 —— 外部 AI（claude / codex）经 MCP 操作本项目时会实时出现在这里。</span>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <Virtualizer as="ul">
        {merged.map((ev) => {
          const Icon = ACTION_ICON[ev.action] ?? BookOpen01Icon;
          return (
            <li
              key={ev.id}
              className="flex gap-3 border-b border-border/60 px-1.5 py-2.5 text-sm last:border-0"
            >
              <HugeiconsIcon
                icon={Icon}
                strokeWidth={2}
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  ev.status === "error" ? "text-destructive" : "text-muted-foreground",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-foreground">{ev.summary}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded bg-muted px-1">{ACTION_LABEL[ev.action] ?? ev.action}</span>
                  <span className="rounded bg-muted px-1">{ev.tool}</span>
                  {ev.provider && <span>{ev.provider}</span>}
                  {ev.status === "error" && <span className="text-destructive">失败</span>}
                  <span>{fmtTime(ev.ts)}</span>
                </div>
              </div>
              {ev.session_id && (
                <button
                  type="button"
                  onClick={() => navigate("/sessions")}
                  className="shrink-0 self-start rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-accent"
                  title="查看会话"
                >
                  会话
                </button>
              )}
            </li>
          );
        })}
      </Virtualizer>
    </div>
  );
}
