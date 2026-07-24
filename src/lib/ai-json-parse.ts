// AI 回复 JSON 解析公用工具：把「可能带 ```json 围栏 / 前后有解释文字」的 LLM 回复
// 容错解析为对象。chemistry/memory/reading 三处共用（原各有一份，已收敛到此）。

/**
 * 从 AI 回复中提取 JSON 并解析：去 ```json 围栏 → 截取首个 { 到末个 } → JSON.parse。
 * 失败返回 null（调用方各自做领域字段校验）。
 */
export function parseJsonReply(reply: string): unknown | null {
  if (!reply) return null;
  let s = reply.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** 安全读取字符串字段（非字符串返回 undefined）。 */
export function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** 安全读取对象（非普通对象/数组返回 null）。 */
export function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
