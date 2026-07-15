import { useSessionsStore } from "../../store/sessions";
import type { Session } from "../../types/session";
import { SessionCard } from "../sessions/SessionCard";

// ── Props ──────────────────────────────────────────────────
interface LinkedSessionsPanelProps {
  /** 项目对应的本地仓库路径（board_projects.repo_path） */
  repoPath: string;
}

/**
 * 关联会话面板。
 * 在 session hub 与 Board 项目之间建立两级连接：
 * 以 repo_path == session.project_path 为 join 条件，
 * 列出属于该项目的所有本地会话（只读）。
 */
export function LinkedSessionsPanel({ repoPath }: LinkedSessionsPanelProps) {
  // 从会话 store 读取全部会话，按 project_path 过滤
  const sessions = useSessionsStore((s) => s.sessions);
  const linked: Session[] = sessions.filter((s) => s.project_path === repoPath);

  return (
    <section className="flex flex-col gap-2">
      {/* 面板标题 */}
      <h3 className="text-sm font-medium text-foreground">关联会话</h3>

      {linked.length === 0 ? (
        // 空态提示
        <p className="text-xs text-muted-foreground">该项目暂无关联会话。</p>
      ) : (
        // 复用 SessionCard；只读展示，选中态与点击回调置空
        <div className="flex flex-col gap-2">
          {linked.map((session) => (
            <SessionCard
              key={session.session_id}
              session={session}
              selected={false}
              onSelect={() => {}}
            />
          ))}
        </div>
      )}
    </section>
  );
}
