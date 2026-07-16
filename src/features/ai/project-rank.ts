// 轻量 RAG 的纯逻辑（无 IO 依赖，便于单测）：关键词相关性打分 + 分块挑选。

/** 上下文字符预算（超出截断，避免超模型上下文/费用）。 */
export const MAX_CONTEXT_CHARS = 8000;

/** 分词：小写、按非字母数字切分、去重、长度≥2（支持中英/Unicode）。 */
function tokenize(s: string): string[] {
  return Array.from(
    new Set(
      s
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 2),
    ),
  );
}

/**
 * 关键词相关性打分（纯函数）：query 词在 text 中命中的比例。
 * query 无有效词时返回 0（此时调用方回退到原顺序）。
 */
export function scoreRelevance(query: string, text: string): number {
  const terms = tokenize(query);
  if (terms.length === 0) return 0;
  const hay = text.toLowerCase();
  let hits = 0;
  for (const t of terms) if (hay.includes(t)) hits += 1;
  return hits / terms.length;
}

/**
 * 从 chunks 中挑选拼成上下文（纯函数）。
 * query 非空 → 按相关度降序；否则保持原顺序。累计到 budget 为止。
 */
export function selectChunks(
  chunks: string[],
  query: string,
  budget = MAX_CONTEXT_CHARS,
): string {
  let ordered = chunks;
  if (query.trim()) {
    ordered = chunks
      .map((c) => ({ c, s: scoreRelevance(query, c) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }
  const picked: string[] = [];
  let used = 0;
  for (const c of ordered) {
    if (used + c.length > budget && picked.length > 0) break;
    picked.push(c);
    used += c.length + 2;
  }
  let ctx = picked.join("\n\n");
  if (ctx.length > budget) ctx = ctx.slice(0, budget) + "\n…（上下文已截断）";
  return ctx;
}
