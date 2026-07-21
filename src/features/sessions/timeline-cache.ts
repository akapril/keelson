// 会话时间线前端缓存：同一会话反复打开时避免重复读取/解析后端 .jsonl，实现"秒开"。
// 思路对标"索引一次、查询即取"：以 provider:id:message_count 为键——消息数变了(会话有新消息)
// 自动失效重取，保证不读脏；未变则直接命中内存。带 FIFO 上限防止长期占内存。
import type { AiChatMessage } from "@/types/ai";

const MAX_ENTRIES = 24; // 最多缓存最近打开的 24 个会话时间线
const store = new Map<string, AiChatMessage[]>();

// 缓存键：消息数并入键——会话追加了消息则键变、旧缓存自然失效（不读脏数据）。
function keyOf(provider: string, id: string, messageCount: number): string {
  return `${provider}:${id}:${messageCount}`;
}

export function getCachedTimeline(
  provider: string,
  id: string,
  messageCount: number,
): AiChatMessage[] | undefined {
  return store.get(keyOf(provider, id, messageCount));
}

export function setCachedTimeline(
  provider: string,
  id: string,
  messageCount: number,
  messages: AiChatMessage[],
): void {
  // FIFO 淘汰：超过上限先删最早插入的键
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(keyOf(provider, id, messageCount), messages);
}
