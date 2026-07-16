// 化学反应沉淀：从会话时间线提炼「可沉淀成果」（候选任务 + 候选文档）。
// prompt 构造 + AI 回复解析为纯函数（可单测）；写入与 UI 在别处。
import type { TaskPriority } from "@/types/board";
import type { TimelineMessage } from "@/types/session";

export interface TaskCandidate {
  title: string;
  description?: string;
  priority: TaskPriority;
}
export interface DocCandidate {
  title: string;
  content: string;
}
export interface Candidates {
  tasks: TaskCandidate[];
  docs: DocCandidate[];
}

const PRIORITIES: TaskPriority[] = ["none", "low", "medium", "high", "urgent"];
const MAX_CONTEXT_CHARS = 12000;

/** 提炼用系统提示：要求严格 JSON 输出。 */
export const EXTRACT_SYSTEM = `你是知识沉淀助手。从给定的编程会话中提炼可长期留存的成果，只输出严格 JSON（不要解释、不要代码块围栏）：
{"tasks":[{"title":"简短标题","description":"可选补充","priority":"none|low|medium|high|urgent"}],"docs":[{"title":"文档标题","content":"Markdown 正文"}]}
tasks = 会话中提到的待办 / 后续行动项；docs = 值得沉淀为文档的结论、方案、排错记录或笔记。没有就用空数组。标题用简洁中文。`;

/** 把时间线拼为提炼上下文（仅 user/assistant，尾部截断到预算内）。 */
export function buildContext(timeline: TimelineMessage[]): string {
  const parts = timeline
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.content}`);
  const joined = parts.join("\n\n");
  return joined.length > MAX_CONTEXT_CHARS
    ? joined.slice(-MAX_CONTEXT_CHARS)
    : joined;
}

/** 安全读取对象字段。 */
function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * 解析 AI 回复为候选。容错：去除 ```json 围栏、截取首个 { 到末个 }；失败返回空。
 */
export function parseCandidates(reply: string): Candidates {
  const empty: Candidates = { tasks: [], docs: [] };
  if (!reply) return empty;

  let s = reply.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);

  let obj: Record<string, unknown> | null;
  try {
    obj = asRecord(JSON.parse(s));
  } catch {
    return empty;
  }
  if (!obj) return empty;

  const tasks: TaskCandidate[] = Array.isArray(obj.tasks)
    ? obj.tasks
        .map(asRecord)
        .filter((t): t is Record<string, unknown> => !!t && !!asString(t.title)?.trim())
        .map((t) => {
          const pr = asString(t.priority);
          return {
            title: asString(t.title)!.trim(),
            description: asString(t.description)?.trim() || undefined,
            priority: (pr && PRIORITIES.includes(pr as TaskPriority)
              ? pr
              : "none") as TaskPriority,
          };
        })
    : [];

  const docs: DocCandidate[] = Array.isArray(obj.docs)
    ? obj.docs
        .map(asRecord)
        .filter((d): d is Record<string, unknown> => !!d && !!asString(d.title)?.trim())
        .map((d) => ({
          title: asString(d.title)!.trim(),
          content: asString(d.content) ?? "",
        }))
    : [];

  return { tasks, docs };
}
