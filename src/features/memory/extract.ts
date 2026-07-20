// 记忆抽取：从会话时间线 AI 出候选记忆 + 字符级去重（MVP，不依赖向量）。
// prompt 构造与解析、去重均为纯函数（可单测）；写入与 UI 在别处。
import type { MemoryKind, MemoryScope, Memory } from "@/types/memory";

export interface MemoryCandidate {
  content: string;
  kind: MemoryKind;
  scope: MemoryScope;
  confidence: number;
}

const KINDS: MemoryKind[] = ["fact", "preference", "decision", "convention"];
const SCOPES: MemoryScope[] = ["global", "project"];

/** 记忆抽取系统提示：严格 JSON、中文、只提可长期留存的断言。 */
export const MEMORY_EXTRACT_SYSTEM = `你是知识沉淀助手。从给定的编程会话中提炼**可长期复用**的记忆，只输出严格 JSON（不要解释、不要代码块围栏）：
{"memories":[{"content":"一句话断言","kind":"fact|preference|decision|convention","scope":"global|project","confidence":0-100}]}
- fact=稳定事实（如技术栈/接口约定）；preference=用户偏好（如"注释用中文"）；decision=技术决策+理由；convention=项目约定。
- scope：跨项目通用=global；仅本项目=project。
- content 用简洁中文、单条一个断言；只提值得长期留存的，没有就空数组。confidence 为你的把握（0-100）。`;

/** 从 AI 回复解析候选记忆。容错：去围栏、截首个 { 到末个 }、字段校验；失败返回空。 */
export function parseMemories(reply: string): MemoryCandidate[] {
  if (!reply) return [];
  let s = reply.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);

  let obj: unknown;
  try {
    obj = JSON.parse(s);
  } catch {
    return [];
  }
  const arr =
    obj && typeof obj === "object" && Array.isArray((obj as { memories?: unknown }).memories)
      ? (obj as { memories: unknown[] }).memories
      : [];
  const out: MemoryCandidate[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const content = typeof r.content === "string" ? r.content.trim() : "";
    if (!content) continue;
    const kind = (KINDS.includes(r.kind as MemoryKind) ? r.kind : "fact") as MemoryKind;
    const scope = (SCOPES.includes(r.scope as MemoryScope) ? r.scope : "project") as MemoryScope;
    const confRaw = typeof r.confidence === "number" ? r.confidence : Number(r.confidence);
    const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(100, confRaw)) : 50;
    out.push({ content, kind, scope, confidence });
  }
  return out;
}

/** 规范化：小写 + 去空白与标点，用于去重比对（跨中英）。 */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** 两条记忆是否重复：同 kind+scope 且规范化后相等或一方包含另一方。 */
export function isDuplicate(
  a: { content: string; kind: MemoryKind; scope: MemoryScope },
  b: { content: string; kind: MemoryKind; scope: MemoryScope },
): boolean {
  if (a.kind !== b.kind || a.scope !== b.scope) return false;
  const na = normalize(a.content);
  const nb = normalize(b.content);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export interface ClassifiedCandidate {
  candidate: MemoryCandidate;
  /** 命中的已有记忆 id（重复）；null 表示新记忆 */
  duplicateOf: string | null;
}

/**
 * 把候选按"是否与已有记忆重复"分类。重复的给出命中记忆 id（供合并/追加来源）。
 * 同一批候选内部也去重（后来的与前面已收的 fresh 撞则视为重复，避免一次抽出两条同义）。
 */
export function classifyCandidates(
  candidates: MemoryCandidate[],
  existing: Memory[],
): ClassifiedCandidate[] {
  const freshSoFar: MemoryCandidate[] = [];
  return candidates.map((cand) => {
    const hit = existing.find((m) => !m.superseded_by && isDuplicate(cand, m));
    if (hit) return { candidate: cand, duplicateOf: hit.id };
    const dupInBatch = freshSoFar.some((f) => isDuplicate(cand, f));
    if (dupInBatch) return { candidate: cand, duplicateOf: "" }; // 批内重复（无 id）
    freshSoFar.push(cand);
    return { candidate: cand, duplicateOf: null };
  });
}
