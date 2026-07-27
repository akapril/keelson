// 自动同步：Claude 的 TaskCreate/TaskUpdate 经「活动流 hook」实时到达前端时，
// 防抖后自动把该会话规划的任务同步进匹配的看板项目——无需手动点「同步任务」。
// 复用 syncSessionTasks;仅前端，依赖：①活动 hook 已启用 ②session_tasks Rust 命令。
import { toast } from "sonner";
import { listProjects } from "@/lib/pb/board";
import { syncSessionTasks } from "./sync-session-tasks";
import { getAutoSyncTasks } from "./auto-sync-pref";
import type { ActivityEvent } from "@/types/activity";
import i18n from "../../i18n";

// 触发同步的工具（大小写不敏感匹配，防后端归一化差异）
const TASK_TOOLS = new Set(["taskcreate", "taskupdate"]);
// 防抖：TaskCreate/TaskUpdate 常成串到达，安静一会儿再同步一次
const DEBOUNCE_MS = 1500;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * 活动事件若是 Task 工具，则防抖后自动同步该会话任务到匹配项目。
 * 非 Task 事件 / 非 Claude / 无 session 直接忽略；无匹配项目静默跳过。
 */
export function maybeAutoSyncTasks(ev: ActivityEvent): void {
  if (!getAutoSyncTasks()) return; // 设置里关了自动同步 → 只走手动按钮
  if (!ev.tool || !TASK_TOOLS.has(ev.tool.toLowerCase())) return;
  if (ev.provider && ev.provider !== "claude") return; // v1 仅 Claude
  const sid = ev.session_id;
  if (!sid) return;

  const prev = timers.get(sid);
  if (prev) clearTimeout(prev);
  timers.set(
    sid,
    setTimeout(() => {
      timers.delete(sid);
      void runSync(sid, ev.provider || "claude", ev.project_id, ev.repo_path);
    }, DEBOUNCE_MS),
  );
}

async function runSync(
  sessionId: string,
  provider: string,
  projectId: string | undefined,
  repoPath: string | undefined,
): Promise<void> {
  try {
    // 优先用后端已路由的 project_id；否则按 repo_path 匹配看板项目
    let pid = projectId;
    if (!pid && repoPath) {
      const projects = await listProjects();
      pid = projects.find((p) => p.repo_path && p.repo_path === repoPath)?.id;
    }
    if (!pid) return; // 该仓库未建成看板项目 → 静默（不打扰）

    const r = await syncSessionTasks(sessionId, provider, pid);
    // 低打扰：仅「新建了卡片」时轻提示；纯状态更新（卡片移列）不弹，靠看板实时渲染呈现
    if (r.created > 0) {
      toast.message(i18n.t("autoSync.toast.synced", { ns: "board", count: r.created }));
    }
  } catch {
    // 自动同步失败静默（手动「同步任务」按钮仍可兜底）
  }
}
