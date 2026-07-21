// 文档大纲(TOC)纯函数：从 Markdown 正文解析标题层级，供全页编辑器右侧大纲导航。
// 关键：跳过围栏代码块内的 "#"（那是注释/shell 提示符，不是标题），避免误入大纲。

export interface TocHeading {
  /** 标题级别 1..6 */
  level: number;
  /** 标题纯文本（去掉行首 # 与尾随 #） */
  text: string;
  /** 在整篇文档中的标题序号（0 基），与富文本渲染出的 h1..h6 DOM 顺序一一对应 */
  index: number;
}

// ATX 标题：行首 1-6 个 #，其后至少一个空格
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
// 围栏代码块起止：``` 或 ~~~（允许前置缩进与语言标注）
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * 解析 Markdown 正文中的标题，返回有序大纲。
 * 跳过围栏代码块内容；index 与富文本 DOM 中标题出现顺序对齐（用于点击滚动定位）。
 */
export function parseHeadings(markdown: string): TocHeading[] {
  if (!markdown) return [];
  const out: TocHeading[] = [];
  let index = 0;
  let inFence = false;
  let fenceMarker = "";

  for (const rawLine of markdown.split("\n")) {
    const fence = rawLine.match(FENCE_RE);
    if (fence) {
      const marker = fence[1][0]; // ` 或 ~
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        // 同类围栏闭合
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;

    const m = rawLine.match(HEADING_RE);
    if (!m) continue;
    // 去掉 setext/ATX 尾随的 #（如 "## 标题 ##"）与首尾空白
    const text = m[2].replace(/\s+#+\s*$/, "").trim();
    if (!text) continue; // 空标题（如 "## "）不计入
    out.push({ level: m[1].length, text, index: index++ });
  }
  return out;
}
