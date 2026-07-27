// 阅读 AI 摘要编排:抓网页正文 → AI 出 JSON{summary,key_points} → 解析。
// 复用现有 fetch_url_text(Rust,已 MAX 12000 截断)+ ai_chat;解析走 parseSummary。
import { ipc } from "@/lib/tauri/ipc";
import type { AiConfig, AiChatMessage } from "@/types/ai";
import type { ReadingItem } from "@/types/reading";
import { parseSummary } from "./reading-utils";

/** 摘要系统提示:严格 JSON、中文。要求"够用"——有信息量、能替代读全文的程度。 */
export const SUMMARY_SYSTEM = `你是资深阅读助手。根据给定网页正文,产出一份"读完就大致掌握、能替代通读全文"的中文摘要。输出严格 JSON(不要解释、不要代码块围栏):
{"summary":"markdown 摘要","key_points":["要点1","要点2"],"tags":["标签1","标签2"]}

要求:
- summary 用 markdown,分三段:①一句话 TL;DR(黑体开头,直接给结论/核心观点);②2-4 句展开背景与主要内容;③「为什么值得读 / 适合谁」一句。信息要具体(带上关键数据、结论、方法名),不要空泛套话。
- key_points 列 5-8 条**具体**要点:每条是一个可独立成立的事实/结论/步骤,而非泛泛而谈。有数据/名词就带上。
- tags 给 2-4 个精炼主题标签(如"LLM""性能优化""创业"),便于归类。
用简体中文。`;

// 送入 AI 的正文上限(控成本;fetch_url_text 已截断,这里再兜底;放宽到 12000 与 Rust 抓取上限对齐)
const MAX_INPUT = 12000;

/**
 * 对阅读条目做 AI 摘要。抓取/AI/解析任一步失败即抛错(中文),由调用方 toast。
 * @returns { summary, key_points, content_text } —— 调用方负责写回 PB。
 */
export async function summarizeReadingItem(
  item: ReadingItem,
  cfg: AiConfig,
): Promise<{ summary: string; key_points: string[]; tags: string[]; content_text: string }> {
  // 该条目无链接，无法摘要 → sentinel，由调用方映射 i18n key
  if (!item.url) throw new Error("NO_LINK");
  const content_text = (await ipc.fetchUrlText(item.url)).trim();
  // 未能抓取到网页正文 → sentinel
  if (!content_text) throw new Error("NO_CONTENT");

  const input =
    content_text.length > MAX_INPUT ? content_text.slice(0, MAX_INPUT) : content_text;
  const msgs: AiChatMessage[] = [
    { role: "system", content: SUMMARY_SYSTEM },
    { role: "user", content: input },
  ];
  const reply = (await ipc.aiChat(cfg, msgs)).trim();
  const parsed = parseSummary(reply);
  // AI 摘要解析失败（未返回有效 JSON） → sentinel
  if (!parsed) throw new Error("PARSE_FAILED");

  return {
    summary: parsed.summary,
    key_points: parsed.key_points,
    tags: parsed.tags,
    content_text,
  };
}
