// Activity PB SDK 数据访问层 —— 唯一允许调用 pb.collection("activities") 的文件。
// 只读持久历史（写操作活动，供项目「活动」tab 回放）；写入由后端 MCP server 落库。
import { pb } from "../pb";
import type { ActivityEvent, ActivityAction, ActivityStatus } from "../../types/activity";

const COLL = "activities";

/** PB activities 记录形态（字段名对齐迁移）。 */
interface ActivityRecord {
  id: string;
  source: string;
  provider: string;
  tool: string;
  action: string;
  summary: string;
  project: string;
  repo_path: string;
  session_id: string;
  status: string;
  created: string;
}

/** PB 记录 → 前端统一的 ActivityEvent（与内存流同构，便于合并去重）。 */
function toEvent(r: ActivityRecord): ActivityEvent {
  return {
    id: r.id,
    ts: r.created,
    source: r.source === "hook" ? "hook" : "mcp",
    provider: r.provider || "",
    tool: r.tool,
    action: (r.action || "read") as ActivityAction,
    summary: r.summary,
    project_id: r.project || undefined,
    repo_path: r.repo_path || undefined,
    session_id: r.session_id || undefined,
    status: (r.status === "error" ? "error" : "ok") as ActivityStatus,
  };
}

/**
 * 拉取持久活动历史（owner 范围由访问规则保证）。
 * 可选按 project 过滤；按 created 倒序，最多 100 条。
 */
export async function listActivities(projectId?: string): Promise<ActivityEvent[]> {
  // getList(1, 100)：单页取最近 100 条（倒序），无需拉全量。
  const res = await pb.collection(COLL).getList<ActivityRecord>(1, 100, {
    requestKey: null,
    sort: "-created",
    // 值最简转义（禁双引号注入），过滤当前项目
    filter: projectId ? `project = "${projectId.replace(/"/g, "")}"` : undefined,
  });
  return res.items.map(toEvent);
}
