// 工作报告生成编排：采集三类素材（Git 提交 / 完成任务 / AI 会话）→ 拼素材 → AI 出 Markdown。
// 复用 gitLog + listProjects/listAllTasks/listAllStates + 会话 store + ipc.aiChat。
// 素材为空则直接返回占位说明，不调用 AI（省成本）。
import { ipc } from "@/lib/tauri/ipc";
import { listProjects, listAllTasks, listAllStates } from "@/lib/pb/board";
import { useSessionsStore } from "@/store/sessions";
import type { AiConfig, AiChatMessage } from "@/types/ai";
import type { CommitInfo } from "@/types/git";
import type { BoardTask } from "@/types/board";
import type { Session } from "@/types/session";
import type { DateRange } from "./report-range";
import {
  dedupeCommits,
  filterCompletedInWindow,
  filterSessionsInWindow,
  buildReportMaterial,
  hasAnyMaterial,
  type ReportMaterial,
  type LabeledCommits,
  type LabeledTasks,
  type LabeledSessions,
} from "./report-collect";

/** 报告助手系统提示：综合素材成一份专业中文工作报告（Markdown）。 */
export const REPORT_SYSTEM = `你是工作汇报助手。根据给定的「原始素材」（某时间段内的 Git 提交、完成的看板任务、AI 会话活动），生成一份简洁专业的中文工作报告（Markdown 正文）。要求：
- 开头一句话总览本段时间的主要产出。
- 按项目分节（## 项目名），每节用要点概括「做了什么」，可引用关键提交或完成的任务作为佐证。
- 结尾可给「亮点」或「下一步」（如素材支持）。
- 直接输出 Markdown，不要代码块围栏、不要额外解释。
- 忠于素材，不要臆造未出现的内容。`;

const GIT_LIMIT = 200; // 每仓库最多取的提交数（防超 token）
const EMPTY_REPORT = "本段时间内没有可汇报的活动（无提交、完成任务或会话记录）。";

/** 报告范围：全部项目，或指定单个项目。 */
export type ReportScope = "all" | { projectId: string };

/** 路径末段目录名（无项目名时作仓库标签）。 */
function repoTail(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/**
 * 生成工作报告。
 * @returns Markdown 正文；素材为空时返回占位说明。
 */
export async function generateReport(
  range: DateRange,
  scope: ReportScope,
  cfg: AiConfig,
): Promise<string> {
  const singleId = typeof scope === "object" ? scope.projectId : null;

  // 项目 / 任务 / 状态：PB 全量拉（owner 范围由访问规则保证）
  const [projects, tasks, states] = await Promise.all([
    listProjects(),
    listAllTasks(),
    listAllStates(),
  ]);
  // 会话取自 store（首次为空则触发一次加载）
  let sessions = useSessionsStore.getState().sessions;
  if (sessions.length === 0) {
    await useSessionsStore.getState().load().catch(() => {});
    sessions = useSessionsStore.getState().sessions;
  }

  const scopedProjects = singleId ? projects.filter((p) => p.id === singleId) : projects;
  const projById = new Map(projects.map((p) => [p.id, p]));

  // ── 仓库 → 提交 ──────────────────────────────────────────
  // 仓库来源：项目 repo_path ∪ 会话 project_path（单项目模式仅该项目 repo_path）。
  const repoLabels = new Map<string, string>(); // repoPath → 展示标签（项目名优先）
  for (const p of scopedProjects) {
    if (p.repo_path) repoLabels.set(p.repo_path, p.name);
  }
  if (!singleId) {
    for (const s of sessions) {
      if (s.project_path && !repoLabels.has(s.project_path)) {
        repoLabels.set(s.project_path, s.project_name || repoTail(s.project_path));
      }
    }
  }
  const repoPaths = [...repoLabels.keys()];
  const perRepo = await Promise.all(
    repoPaths.map((path) =>
      ipc
        .gitLog(path, range.sinceISO, range.untilISO, GIT_LIMIT)
        .catch(() => [] as CommitInfo[]),
    ),
  );
  const commitGroups: LabeledCommits[] = repoPaths
    .map((path, i) => ({
      label: repoLabels.get(path) ?? repoTail(path),
      commits: dedupeCommits(perRepo[i]),
    }))
    .filter((g) => g.commits.length > 0);

  // ── 完成任务 ─────────────────────────────────────────────
  const completedIds = new Set(
    states.filter((s) => s.category === "completed").map((s) => s.id),
  );
  const scopedTasks = singleId ? tasks.filter((t) => t.project === singleId) : tasks;
  const doneTasks = filterCompletedInWindow(
    scopedTasks,
    completedIds,
    range.sinceMs,
    range.untilMs,
  );
  const taskByProj = new Map<string, BoardTask[]>();
  for (const t of doneTasks) {
    const arr = taskByProj.get(t.project) ?? [];
    arr.push(t);
    taskByProj.set(t.project, arr);
  }
  const taskGroups: LabeledTasks[] = [...taskByProj.entries()].map(([pid, ts]) => ({
    label: projById.get(pid)?.name ?? "（未知项目）",
    tasks: ts,
  }));

  // ── 会话 ─────────────────────────────────────────────────
  const scopedSessions = singleId
    ? sessions.filter((s) => {
        const p = projById.get(singleId);
        return p?.repo_path ? s.project_path === p.repo_path : false;
      })
    : sessions;
  const winSessions = filterSessionsInWindow(scopedSessions, range.sinceMs, range.untilMs);
  const sessByProj = new Map<string, Session[]>();
  for (const s of winSessions) {
    const arr = sessByProj.get(s.project_path) ?? [];
    arr.push(s);
    sessByProj.set(s.project_path, arr);
  }
  const sessionGroups: LabeledSessions[] = [...sessByProj.entries()].map(([path, ss]) => ({
    label: repoLabels.get(path) ?? ss[0]?.project_name ?? repoTail(path),
    sessions: ss,
  }));

  const material: ReportMaterial = {
    rangeLabel: range.label,
    commitGroups,
    taskGroups,
    sessionGroups,
  };
  if (!hasAnyMaterial(material)) return EMPTY_REPORT;

  const msgs: AiChatMessage[] = [
    { role: "system", content: REPORT_SYSTEM },
    { role: "user", content: buildReportMaterial(material) },
  ];
  const reply = (await ipc.aiChat(cfg, msgs)).trim();
  return reply || EMPTY_REPORT;
}
