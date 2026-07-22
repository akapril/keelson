// 工作报告素材采集的纯函数（窗口过滤 / 去重 / 拼装），可独立测试。
// 采集的副作用（gitLog、拉 PB、AI）在 generateReport.ts。
import type { CommitInfo } from "@/types/git";
import type { BoardTask } from "@/types/board";
import type { Session } from "@/types/session";

/** iso 时间是否落在 [sinceMs, untilMs]（含）；解析失败视为不在窗口。 */
export function inWindow(iso: string, sinceMs: number, untilMs: number): boolean {
  const t = Date.parse(iso || "");
  return !Number.isNaN(t) && t >= sinceMs && t <= untilMs;
}

/** 按 hash 去重（保留首次出现）：多仓库/关联查询可能带来重复提交。 */
export function dedupeCommits(commits: CommitInfo[]): CommitInfo[] {
  const seen = new Set<string>();
  const out: CommitInfo[] = [];
  for (const c of commits) {
    if (seen.has(c.hash)) continue;
    seen.add(c.hash);
    out.push(c);
  }
  return out;
}

/**
 * 完成任务 = state 属「完成」类别 且 updated 落窗口内。
 * 归档的完成任务也计入（报告要体现"完成了什么"，归档只是软删除）。
 */
export function filterCompletedInWindow(
  tasks: BoardTask[],
  completedStateIds: Set<string>,
  sinceMs: number,
  untilMs: number,
): BoardTask[] {
  return tasks.filter(
    (t) => completedStateIds.has(t.state) && inWindow(t.updated, sinceMs, untilMs),
  );
}

/** 窗口内活跃的会话（按 updated_at）。 */
export function filterSessionsInWindow(
  sessions: Session[],
  sinceMs: number,
  untilMs: number,
): Session[] {
  return sessions.filter((s) => inWindow(s.updated_at, sinceMs, untilMs));
}

// ── 素材拼装 ──────────────────────────────────────────────
export interface LabeledCommits {
  label: string;
  commits: CommitInfo[];
}
export interface LabeledTasks {
  label: string;
  tasks: BoardTask[];
}
export interface LabeledSessions {
  label: string;
  sessions: Session[];
}

export interface ReportMaterial {
  rangeLabel: string;
  commitGroups: LabeledCommits[];
  taskGroups: LabeledTasks[];
  sessionGroups: LabeledSessions[];
}

/** 是否有任何可汇报素材（全空则不必调用 AI，省成本）。 */
export function hasAnyMaterial(m: ReportMaterial): boolean {
  return (
    m.commitGroups.some((g) => g.commits.length > 0) ||
    m.taskGroups.some((g) => g.tasks.length > 0) ||
    m.sessionGroups.some((g) => g.sessions.length > 0)
  );
}

const SNIP = 80;
const dayOf = (iso: string) => (iso || "").slice(0, 10);
const snip = (s: string) => {
  const one = (s || "").replace(/\s+/g, " ").trim();
  return one.length > SNIP ? one.slice(0, SNIP) + "…" : one;
};

/**
 * 拼装喂给 AI 的「原始素材」文本：三大节（提交/完成任务/会话），各按标签分组。
 * 输出为结构化 Markdown，AI 据此综合成工作报告。
 */
export function buildReportMaterial(m: ReportMaterial): string {
  const lines: string[] = [`时间范围：${m.rangeLabel}`, ""];

  const commitN = m.commitGroups.reduce((a, g) => a + g.commits.length, 0);
  lines.push(`## Git 提交（${commitN} 条）`);
  if (commitN === 0) lines.push("（无）");
  for (const g of m.commitGroups) {
    if (g.commits.length === 0) continue;
    lines.push(`### ${g.label}`);
    for (const c of g.commits) {
      lines.push(`- ${c.short} ${snip(c.subject)}（${dayOf(c.committed_at)}）`);
    }
  }
  lines.push("");

  const taskN = m.taskGroups.reduce((a, g) => a + g.tasks.length, 0);
  lines.push(`## 完成任务（${taskN} 个）`);
  if (taskN === 0) lines.push("（无）");
  for (const g of m.taskGroups) {
    if (g.tasks.length === 0) continue;
    lines.push(`### ${g.label}`);
    for (const t of g.tasks) lines.push(`- ${snip(t.title)}（完成于 ${dayOf(t.updated)}）`);
  }
  lines.push("");

  const sessN = m.sessionGroups.reduce((a, g) => a + g.sessions.length, 0);
  lines.push(`## AI 会话活动（${sessN} 个）`);
  if (sessN === 0) lines.push("（无）");
  for (const g of m.sessionGroups) {
    if (g.sessions.length === 0) continue;
    lines.push(`### ${g.label}`);
    for (const s of g.sessions) {
      const topic = snip(s.first_prompt || s.last_prompt || "(无提示词)");
      lines.push(`- ${topic}（${s.message_count} 条消息，${dayOf(s.updated_at)}）`);
    }
  }

  return lines.join("\n").trim();
}
