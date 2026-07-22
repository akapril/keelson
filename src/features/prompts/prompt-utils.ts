// 指令标签工具：空格/逗号（中英）分隔 ↔ 数组。
export function splitTags(s: string): string[] {
  return (s || "")
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}
