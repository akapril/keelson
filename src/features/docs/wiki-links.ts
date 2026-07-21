// Wiki 双链解析（纯函数）：从 Markdown 正文提取 [[标题]] / [[标题|别名]] 引用目标。
// 跳过围栏代码块内的 [[ ]]（那是代码不是链接）。供文档页展示「出链 / 反向链接」，
// 构成文档间的知识网络导航（不改编辑器内部，低风险）。
const WIKI_RE = /\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * 解析正文中的所有 [[目标]] 引用，返回去重后的目标标题列表（保持首次出现顺序）。
 * [[A|别名]] 取 A；跳过围栏代码块内内容。
 */
export function parseWikiLinks(markdown: string): string[] {
  if (!markdown) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  let inFence = false;
  let fenceMarker = "";

  for (const line of markdown.split("\n")) {
    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;

    for (const m of line.matchAll(WIKI_RE)) {
      const target = m[1].trim();
      if (!target) continue;
      const key = target.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(target);
    }
  }
  return out;
}

/** 判断正文是否引用了某标题（大小写不敏感），用于计算反向链接。 */
export function contentLinksTo(markdown: string, title: string): boolean {
  const t = title.trim().toLowerCase();
  if (!t) return false;
  return parseWikiLinks(markdown).some((x) => x.toLowerCase() === t);
}
