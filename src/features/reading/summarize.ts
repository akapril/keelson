// 阅读 AI 摘要编排:抓网页正文 → AI 出 JSON{summary,key_points} → 解析。
// 复用现有 fetch_url_text(Rust,已 MAX 12000 截断)+ ai_chat;解析走 parseSummary。
import { ipc } from "@/lib/tauri/ipc";
import type { AiConfig, AiChatMessage } from "@/types/ai";
import type { ReadingItem } from "@/types/reading";
import { parseSummary } from "./reading-utils";

/** 摘要系统提示:严格 JSON、中文。 */
export const SUMMARY_SYSTEM = `你是阅读助手。根据给定网页正文,输出严格 JSON(不要解释、不要代码块围栏):
{"summary":"一段简洁中文摘要","key_points":["要点1","要点2"]}
summary 概括核心内容;key_points 列 3-6 个关键点。用中文。`;

// 送入 AI 的正文上限(控成本;fetch_url_text 已截断,这里再兜底)
const MAX_INPUT = 8000;

/**
 * 对阅读条目做 AI 摘要。抓取/AI/解析任一步失败即抛错(中文),由调用方 toast。
 * @returns { summary, key_points, content_text } —— 调用方负责写回 PB。
 */
export async function summarizeReadingItem(
  item: ReadingItem,
  cfg: AiConfig,
): Promise<{ summary: string; key_points: string[]; content_text: string }> {
  if (!item.url) throw new Error("该条目无链接,无法摘要");
  const content_text = (await ipc.fetchUrlText(item.url)).trim();
  if (!content_text) throw new Error("未能抓取到网页正文");

  const input =
    content_text.length > MAX_INPUT ? content_text.slice(0, MAX_INPUT) : content_text;
  const msgs: AiChatMessage[] = [
    { role: "system", content: SUMMARY_SYSTEM },
    { role: "user", content: input },
  ];
  const reply = (await ipc.aiChat(cfg, msgs)).trim();
  const parsed = parseSummary(reply);
  if (!parsed) throw new Error("AI 摘要解析失败(未返回有效 JSON)");

  return { summary: parsed.summary, key_points: parsed.key_points, content_text };
}
