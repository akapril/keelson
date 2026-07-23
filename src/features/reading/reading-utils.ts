// 阅读增强纯逻辑:AI 摘要 JSON 解析、标签拆合、置顶分组。无副作用,可单测。
import type { ReadingItem } from "@/types/reading";

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * 解析 AI 回复为 { summary, key_points }。容错:去 ```json 围栏、截取首个 { 到末个 }。
 * summary 缺失/非字符串 → null;key_points 缺失 → 空数组。
 */
export function parseSummary(
  reply: string,
): { summary: string; key_points: string[]; tags: string[] } | null {
  if (!reply) return null;
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
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  const summary = asString(rec.summary)?.trim();
  if (!summary) return null;
  // 字符串数组归一：去空/去空白（key_points 与 tags 共用）
  const strArr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map(asString).filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim())
      : [];
  return {
    summary,
    key_points: strArr(rec.key_points),
    tags: strArr(rec.tags),
  };
}

/** 拆分逗号分隔标签:去空白、去空、去重(保序)。 */
export function splitTags(csv: string): string[] {
  const out: string[] = [];
  for (const raw of (csv || "").split(",")) {
    const t = raw.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** 合并标签为逗号分隔文本。 */
export function joinTags(tags: string[]): string {
  return tags.join(",");
}

/** 按 pinned 拆成置顶组与其余组(保持传入顺序)。 */
export function groupReading(items: ReadingItem[]): {
  pinned: ReadingItem[];
  rest: ReadingItem[];
} {
  return {
    pinned: items.filter((it) => it.pinned),
    rest: items.filter((it) => !it.pinned),
  };
}
