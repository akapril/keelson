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

/** 反转义 JSON 字符串里的常见转义（\n \t \" \\），供从半截 JSON 捞出的文本还原可读。 */
function unescapeJsonStr(v: string): string {
  return v
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/**
 * 从「未能解析为完整 JSON」的 AI 回复里**尽力捞出可读摘要文本**，避免把原始 JSON 直接展示给用户。
 *
 * 典型场景：AI 返回被截断的 JSON（max_tokens 太小，`{"summary":"…` 没写完）→ `parseSummary` 失败。
 * - 优先正则提取 `"summary":"..."` 的值（容忍未闭合：匹配到闭合引号或字符串末尾），并反转义。
 * - 没有 summary 字段（纯散文回复）→ 去掉 ``` 围栏与最外层花括号，返回其余可读文本。
 * - 保底返回原文 trim。纯函数、可单测。
 */
export function salvageSummary(reply: string): string {
  const s = reply.trim();
  // 1) 捞 "summary":"..."（闭合引号可选 → 容忍截断）
  const m = s.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"?/);
  if (m && m[1].trim()) {
    return unescapeJsonStr(m[1]).trim();
  }
  // 2) 无 summary 字段：剥围栏 + 最外层花括号，返回可读文本
  let t = s.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  if (t.startsWith("{")) t = t.replace(/^\{/, "").replace(/\}\s*$/, "").trim();
  return t || s;
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
