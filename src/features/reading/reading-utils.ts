// 阅读增强纯逻辑:AI 摘要 JSON 解析、标签拆合、置顶分组。无副作用,可单测。
import type { ReadingItem } from "@/types/reading";
import { parseJsonReply, asString, asRecord } from "@/lib/ai-json-parse";

/**
 * 解析 AI 回复为 { summary, key_points }。容错解析复用 lib/ai-json-parse。
 * summary 缺失/非字符串 → null;key_points 缺失 → 空数组。
 */
export function parseSummary(
  reply: string,
): { summary: string; key_points: string[]; tags: string[] } | null {
  const rec = asRecord(parseJsonReply(reply));
  if (!rec) return null;
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
