// WorkspaceSessions —— 项目工作台「会话」标签的内容：
// 把会话中枢的「列表 + 预览」体验搬进工作台，scope 到当前项目（repo_path == project_path）。
// 复用 SessionCard（自带 建任务/恢复/收藏）与 SessionPreviewPane（自带 建任务/恢复 + 时间线）。
// 从此会话建任务时，CreateTaskFromSessionDialog 会默认命中 repo_path 匹配的本项目。
import { useEffect, useState } from "react";
import { useSessionsStore } from "@/store/sessions";
import type { Session } from "@/types/session";
import { SessionCard } from "@/features/sessions/SessionCard";
import { SessionPreviewPane } from "@/features/sessions/SessionPreviewPane";

export function WorkspaceSessions({ repoPath }: { repoPath: string }) {
  const sessions = useSessionsStore((s) => s.sessions);
  const linked = sessions.filter((s) => s.project_path === repoPath);
  const [selected, setSelected] = useState<Session | null>(null);

  // 关联会话变化时维护选中项：无则清空；当前项已失效则回退到第一个。
  useEffect(() => {
    if (linked.length === 0) {
      if (selected) setSelected(null);
      return;
    }
    if (
      !selected ||
      !linked.some((s) => s.session_id === selected.session_id)
    ) {
      setSelected(linked[0]);
    }
    // 仅在项目路径或会话列表变化时重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, sessions]);

  if (linked.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        该项目暂无关联的本地会话（会话的 project_path 需等于项目 repo_path）。
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* 左：关联会话列表（可选中） */}
      <div className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto pr-1">
        <div className="shrink-0 px-0.5 text-xs text-muted-foreground">
          {linked.length} 个关联会话
        </div>
        {linked.map((s) => (
          <SessionCard
            key={s.session_id}
            session={s}
            selected={selected?.session_id === s.session_id}
            onSelect={setSelected}
          />
        ))}
      </div>

      {/* 右：选中会话预览（含 建任务 / 恢复） */}
      <div className="min-w-0 flex-1 overflow-hidden">
        <SessionPreviewPane session={selected} />
      </div>
    </div>
  );
}
