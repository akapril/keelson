// 把 markdown 剥成纯文本，供「一行截断预览」用（看板卡片描述等）：
// 去掉标题/列表/强调/代码/链接等语法噪声，折叠空白为单空格。纯函数、可测。
export function stripMarkdown(md: string): string {
  if (!md) return "";
  return md
    .replace(/```[\s\S]*?```/g, " ") // 围栏代码块
    .replace(/`([^`]+)`/g, "$1") // 行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 图片
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // 链接 → 文本
    .replace(/^#{1,6}\s+/gm, "") // 标题标记
    .replace(/^\s{0,3}>\s?/gm, "") // 引用
    .replace(/^\s*[-*+]\s+/gm, "") // 无序列表标记
    .replace(/^\s*\d+\.\s+/gm, "") // 有序列表标记
    .replace(/^\s*[-*_]{3,}\s*$/gm, " ") // 分隔线
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // 粗体
    .replace(/(\*|_)(.*?)\1/g, "$2") // 斜体
    .replace(/~~(.*?)~~/g, "$1") // 删除线
    .replace(/\s+/g, " ") // 折叠空白（含换行）
    .trim();
}
