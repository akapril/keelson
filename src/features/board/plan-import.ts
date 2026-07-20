// 计划 markdown 解析（纯函数，可测）：### Task N → 卡片；# 标题 → 文档标题。
export interface PlanTask {
  n: number;
  title: string;
  body: string;
}

// 行首匹配「### Task 3: 名称」/「### Task 3：名称」（中英冒号皆可）
const TASK_RE = /^###\s+Task\s+(\d+)\s*[:：]\s*(.+?)\s*$/;

/** 解析 ### Task N: 标题 段落；body = 到下一个 ###/## 小节或 EOF（trim）。 */
export function parsePlanTasks(md: string): PlanTask[] {
  const lines = md.split(/\r?\n/);
  const tasks: PlanTask[] = [];
  let cur: PlanTask | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (cur) {
      cur.body = buf.join("\n").trim();
      tasks.push(cur);
    }
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(TASK_RE);
    if (m) {
      // 新任务：先结算上一条
      flush();
      cur = { n: Number(m[1]), title: m[2], body: "" };
      continue;
    }
    // 遇到其它 ###/## 小节（非 Task）：结束当前任务 body 收集
    if (cur && /^##/.test(line.trim())) {
      flush();
      cur = null;
      continue;
    }
    if (cur) buf.push(line);
  }
  flush();
  return tasks;
}

/** 首个 `# 标题`；无则空串。 */
export function parseDocTitle(md: string): string {
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1];
  }
  return "";
}

/** 计划文件名 → 同名 spec 文件名：<base>.md → <base>-design.md。 */
export function specNameForPlan(planName: string): string {
  return planName.replace(/\.md$/i, "-design.md");
}

/** 幂等锚点：plan:<文件名>#task-<N>。 */
export function taskAnchor(planName: string, n: number): string {
  return `plan:${planName}#task-${n}`;
}
