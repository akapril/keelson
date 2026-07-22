// 计划 markdown 解析（纯函数，可测）：卡片 + 文档标题。
// 两种主流格式：① superpowers 的「### Task N: 标题」；② Spec Kit/Kiro/通用的「- [ ] 复选框任务」。
export interface PlanTask {
  n: number;
  title: string;
  body: string;
}

// 行首匹配「### Task 3: 名称」/「### Task 3：名称」（中英冒号皆可）
const TASK_RE = /^###\s+Task\s+(\d+)\s*[:：]\s*(.+?)\s*$/;
// 顶层复选框任务：行首无缩进，marker 为 - / * / 数字.，后接 [ ]/[x]。
// 例：`- [ ] T001 建结构`、`- [ ] 1. 建模型`、`1. [ ] 配置`。缩进的复选框视为子项（并入 body）。
const CHECKBOX_RE = /^(?:[-*]|\d+\.)\s+\[[ xX]\]\s+(.+?)\s*$/;
const INDENTED_CHECKBOX_RE = /^\s+(?:[-*]|\d+\.)\s+\[[ xX]\]/;

/** 去掉任务文本里的编号/并行标记前缀：Spec Kit `T001`、通用 `1.`/`1.1`、`[P]`。 */
function stripTaskId(s: string): string {
  return s
    .replace(/^(?:T\d+|\d+(?:\.\d+)*\.?)\s+/i, "")
    .replace(/^\[[Pp]\]\s*/, "")
    .trim();
}

/** superpowers 风格：解析 ### Task N: 标题 段落。 */
function parseSuperpowersTasks(md: string): PlanTask[] {
  const lines = md.split(/\r?\n/);
  const tasks: PlanTask[] = [];
  let cur: PlanTask | null = null;
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    if (cur) {
      cur.body = buf.join("\n").trim();
      tasks.push(cur);
    }
    buf = [];
  };
  for (const line of lines) {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) {
      inFence = !inFence;
      if (cur) buf.push(line);
      continue;
    }
    if (!inFence) {
      const m = line.match(TASK_RE);
      if (m) {
        flush();
        cur = { n: Number(m[1]), title: m[2], body: "" };
        continue;
      }
      if (cur && /^##/.test(t)) {
        flush();
        cur = null;
        continue;
      }
    }
    if (cur) buf.push(line);
  }
  flush();
  return tasks;
}

/** 通用复选框风格：每个「顶层」`- [ ]` 为一张卡；其下缩进行（含子复选框）并入 body。
 *  覆盖 GitHub Spec Kit（T001…）、Kiro（1./1.1）、任意 tasks.md。 */
function parseCheckboxTasks(md: string): PlanTask[] {
  const lines = md.split(/\r?\n/);
  const tasks: PlanTask[] = [];
  let cur: PlanTask | null = null;
  let buf: string[] = [];
  let inFence = false;
  let n = 0;
  const flush = () => {
    if (cur) {
      cur.body = buf.join("\n").trim();
      tasks.push(cur);
    }
    buf = [];
  };
  for (const line of lines) {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) {
      inFence = !inFence;
      if (cur) buf.push(line);
      continue;
    }
    if (!inFence) {
      // 缩进的复选框 → 子项，并入 body（不新建卡）
      const top = !INDENTED_CHECKBOX_RE.test(line) && line.match(CHECKBOX_RE);
      if (top) {
        flush();
        n += 1;
        const title = stripTaskId(top[1]);
        cur = { n, title: title || top[1].trim(), body: "" };
        continue;
      }
    }
    if (cur) buf.push(line);
  }
  flush();
  return tasks;
}

/** 解析计划里的任务：优先 superpowers（### Task N）；否则退回通用复选框（- [ ]）。
 *  分两路避免冲突：superpowers 计划的 `- [ ]` 是任务内的「步骤」，不应各成一卡。 */
export function parsePlanTasks(md: string): PlanTask[] {
  const sp = parseSuperpowersTasks(md);
  if (sp.length > 0) return sp;
  return parseCheckboxTasks(md);
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
