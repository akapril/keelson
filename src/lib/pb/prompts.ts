// Prompts PB 数据访问层 —— 唯一允许调用 pb.collection 的 prompts 文件。
import { pb } from "../pb";
import type { Prompt } from "../../types/prompt";

const COLL = "prompts";

/** 全部指令（按 updated 降序）。owner 范围由访问规则保证。 */
export function listPrompts(): Promise<Prompt[]> {
  return pb.collection(COLL).getFullList<Prompt>({ requestKey: null, sort: "-updated" });
}

export function createPromptRecord(data: Record<string, unknown>): Promise<Prompt> {
  return pb.collection(COLL).create<Prompt>(data);
}

export function updatePromptRecord(id: string, data: Record<string, unknown>): Promise<Prompt> {
  return pb.collection(COLL).update<Prompt>(id, data);
}

export function deletePromptRecord(id: string): Promise<void> {
  return pb.collection(COLL).delete(id).then(() => undefined);
}
